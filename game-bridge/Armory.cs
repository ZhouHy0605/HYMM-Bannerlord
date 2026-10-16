using System.Text.Json;
using TaleWorlds.Core;
using TaleWorlds.MountAndBlade;
using TaleWorlds.MountAndBlade.Diamond.Cosmetics;
using TaleWorlds.MountAndBlade.Diamond.Cosmetics.CosmeticTypes;
using TaleWorlds.ObjectSystem;

namespace ArenaBridge;

// Only server-side, per-connection cosmetic preferences are changed. The native
// spawn path serializes CosmeticItem while leaving the underlying Item intact.
internal sealed class Armory : MissionBehavior
{
    readonly Transport link;
    static readonly Dictionary<NetworkCommunicator, PeerState> peers = new();
    static readonly ArmoryCache cache = new();
    readonly Dictionary<string,int> classIndices=new(),cosmeticIndices=new();
    double nextUpdate;
    static Task<ArmoryReply>? request;
    static double nextPoll;
    static string lastIds = "";
    sealed class PeerState
    {
        public Dictionary<int,List<int>>? Original;
        public Dictionary<int,List<int>>? Applied;
        public Dictionary<string,string[]>? Choices;
    }
    public Armory(Transport transport) { link=transport; }
    public override MissionBehaviorType BehaviorType => MissionBehaviorType.Other;
    public override void AfterStart()
    {
        try{InstallOverrides();
            var classes=MBObjectManager.Instance.GetObjectTypeList<MultiplayerClassDivisions.MPHeroClass>();
            for(int i=0;i<classes.Count;i++)classIndices[classes[i].StringId]=i;
            for(int i=0;i<CosmeticsManager.CosmeticElementsList.Count;i++)cosmeticIndices[CosmeticsManager.CosmeticElementsList[i].Id]=i;
        }
        catch(Exception e){SubModule.Log("Armory compatibility unavailable: "+e.GetType().Name);}
        SubModule.Log("Armory ready; classes="+MBObjectManager.Instance.GetObjectTypeList<MultiplayerClassDivisions.MPHeroClass>().Count+"; native cosmetics="+CosmeticsManager.CosmeticElementsList.Count);
    }
    sealed class CompatibilityRule
    {
        public string ClassId {get;set;}="";
        public string Slot {get;set;}="";
        public string CosmeticId {get;set;}="";
        public string[] ReplaceItems {get;set;}=Array.Empty<string>();
    }
    static void InstallOverrides()
    {
        using var stream=typeof(Armory).Assembly.GetManifestResourceStream("ArenaBridge.armory-overrides.json")!;
        var rules=JsonSerializer.Deserialize<CompatibilityRule[]>(stream,Transport.Json)!;
        var classes=MBObjectManager.Instance.GetObjectTypeList<MultiplayerClassDivisions.MPHeroClass>();
        var changes=new List<(ClothingCosmeticElement clothing,string target)>();
        foreach(var rule in rules)
        {
            var hero=classes.First(c=>c.StringId==rule.ClassId).HeroCharacter;
            var slot=rule.Slot=="Head"?EquipmentIndex.Head:rule.Slot=="Body"?EquipmentIndex.Body:throw new InvalidOperationException("Unsupported override slot");
            if(!rule.ReplaceItems.Contains(hero.Equipment[slot].Item?.StringId))throw new InvalidOperationException("Native class equipment changed");
            var clothing=CosmeticsManager.CosmeticElementsList.First(c=>c.Id==rule.CosmeticId) as ClothingCosmeticElement??throw new InvalidOperationException("Unknown override cosmetic");
            foreach(var target in rule.ReplaceItems)
            {
                var original=MBObjectManager.Instance.GetObject<ItemObject>(target);
                var cosmetic=MBObjectManager.Instance.GetObject<ItemObject>(rule.CosmeticId);
                if(original==null||cosmetic==null||original.ItemType!=cosmetic.ItemType)throw new InvalidOperationException("Incompatible override item");
                changes.Add((clothing,target));
            }
        }
        // Validate the complete set before extending native, in-memory cosmetic
        // lookups. No Item, equipment, armor or weapon statistics are modified.
        foreach(var (clothing,target) in changes)if(!clothing.ReplaceItemsId.Contains(target))clothing.ReplaceItemsId.Add(target);
        SubModule.Log("Armory HYMM compatibility ready; rules="+rules.Length);
    }
    public override void OnPreMissionTick(float dt)
    {
        if(!link.Config.EnableArmory||ServerNotices.Now<nextUpdate)return;
        nextUpdate=ServerNotices.Now+0.5;
        try { Update(); }
        catch(Exception e) { SubModule.Log("Armory skipped: "+e.GetType().Name); nextPoll=nextUpdate=ServerNotices.Now+30; }
    }
    void Update()
    {
        var connected=GameNetwork.NetworkPeers.Where(p=>!p.IsServerPeer).ToArray();
        var online=connected.Where(p=>p.IsSynchronized).ToArray();
        // Keep the original selection while a connected player loads another map.
        foreach(var p in peers.Keys.ToArray())if(!connected.Contains(p))peers.Remove(p);
        var identities=online.Select(p=>(peer:p,id:NativeIdentity.Resolve(p.VirtualPlayer.Id,link.Config.GameIdToSteamId)))
            .Where(x=>x.id!=null).ToArray();
        var ids=identities.Select(x=>x.id!).Distinct().OrderBy(x=>x).ToArray();
        var key=string.Join(",",ids);
        if(request?.IsCompleted==true)
        {
            try { cache.Apply(request.GetAwaiter().GetResult()); }
            catch(Exception e){SubModule.Log("Armory fetch retry: "+e.GetType().Name);}
            request=null;
        }
        if(request==null&&(ServerNotices.Now>=nextPoll||key!=lastIds))
        {
            nextPoll=ServerNotices.Now+5;lastIds=key;
            cache.Retain(ids);
            if(ids.Length>0)request=link.FetchArmory(ids,cache.Known(ids));
        }
        foreach(var entry in identities)
        {
            if(!cache.Profiles.TryGetValue(entry.id!,out var choices))continue;
            var player=entry.peer.VirtualPlayer;
            if(!peers.TryGetValue(entry.peer,out var saved))peers[entry.peer]=saved=new PeerState{Original=player.UsedCosmetics};
            // Master-server updates may replace the dictionary; keep the new native baseline.
            if(saved.Applied!=null&&!ReferenceEquals(player.UsedCosmetics,saved.Applied))
            { saved.Original=player.UsedCosmetics;saved.Applied=null;saved.Choices=null; }
            if(ReferenceEquals(saved.Choices,choices))continue;
            var result=(saved.Original??new()).ToDictionary(x=>x.Key,x=>new List<int>(x.Value));
            foreach(var choice in choices)
            {
                if(!classIndices.TryGetValue(choice.Key,out var classIndex))throw new InvalidOperationException("Unknown class ID");
                var selected=new List<int>();var targets=new HashSet<string>();
                foreach(var id in choice.Value)
                {
                    if(!cosmeticIndices.TryGetValue(id,out var index)||CosmeticsManager.CosmeticElementsList[index] is not ClothingCosmeticElement clothing)
                        throw new InvalidOperationException("Unknown clothing ID");
                    foreach(var target in clothing.ReplaceItemsId.Concat(clothing.ReplaceItemless.Where(t=>t.Item1==choice.Key).Select(t=>t.Item2)))
                        if(!targets.Add(target))throw new InvalidOperationException("Conflicting cosmetics");
                    selected.Add(index);
                }
                // Preserve native emotes and any non-clothing cosmetic selection.
                if(result.TryGetValue(classIndex,out var original))selected.AddRange(original.Where(i=>i>=0&&i<CosmeticsManager.CosmeticElementsList.Count&&CosmeticsManager.CosmeticElementsList[i] is not ClothingCosmeticElement));
                result[classIndex]=selected;
            }
            player.UsedCosmetics=result;saved.Applied=result;saved.Choices=choices;
            SubModule.Log("Armory applied to connection; configured classes="+choices.Count);
        }
    }
}
