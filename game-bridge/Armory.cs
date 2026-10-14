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
    static Dictionary<string, Dictionary<string, string[]>> profiles = new();
    static Task<Dictionary<string, Dictionary<string, string[]>>>? request;
    static double nextPoll;
    static string lastIds = "";
    sealed class PeerState
    {
        public Dictionary<int,List<int>>? Original;
        public Dictionary<int,List<int>>? Applied;
        public string Signature = "";
        public Dictionary<string,string[]>? Choices;
    }
    public Armory(Transport transport) { link=transport; }
    public override MissionBehaviorType BehaviorType => MissionBehaviorType.Other;
    public override void AfterStart(){SubModule.Log("Armory ready; classes="+MBObjectManager.Instance.GetObjectTypeList<MultiplayerClassDivisions.MPHeroClass>().Count+"; native cosmetics="+CosmeticsManager.CosmeticElementsList.Count);}
    public override void OnPreMissionTick(float dt)
    {
        if(!link.Config.EnableArmory)return;
        try { Update(); }
        catch(Exception e) { SubModule.Log("Armory skipped: "+e.GetType().Name); nextPoll=ServerNotices.Now+30; }
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
            try { profiles=request.GetAwaiter().GetResult(); }
            catch(Exception e){SubModule.Log("Armory fetch retry: "+e.GetType().Name);}
            request=null;
        }
        if(request==null&&(ServerNotices.Now>=nextPoll||key!=lastIds))
        {
            nextPoll=ServerNotices.Now+5;lastIds=key;
            if(ids.Length>0)request=link.FetchArmory(ids);else profiles.Clear();
        }
        foreach(var entry in identities)
        {
            if(!profiles.TryGetValue(entry.id!,out var choices))continue;
            var player=entry.peer.VirtualPlayer;
            if(!peers.TryGetValue(entry.peer,out var saved))peers[entry.peer]=saved=new PeerState{Original=player.UsedCosmetics};
            // Master-server updates may replace the dictionary; keep the new native baseline.
            if(saved.Applied!=null&&!ReferenceEquals(player.UsedCosmetics,saved.Applied))
            { saved.Original=player.UsedCosmetics;saved.Signature="";saved.Applied=null;saved.Choices=null; }
            if(ReferenceEquals(saved.Choices,choices))continue;
            saved.Choices=choices;
            var signature=JsonSerializer.Serialize(choices,Transport.Json);
            if(saved.Signature==signature)continue;
            var result=(saved.Original??new()).ToDictionary(x=>x.Key,x=>new List<int>(x.Value));
            var classes=MBObjectManager.Instance.GetObjectTypeList<MultiplayerClassDivisions.MPHeroClass>();
            foreach(var choice in choices)
            {
                int classIndex=-1;
                for(int i=0;i<classes.Count;i++)if(classes[i].StringId==choice.Key){classIndex=i;break;}
                if(classIndex<0)continue;
                var selected=new List<int>();var targets=new HashSet<string>();
                foreach(var id in choice.Value)
                {
                    int index=-1;
                    for(int i=0;i<CosmeticsManager.CosmeticElementsList.Count;i++)
                        if(CosmeticsManager.CosmeticElementsList[i].Id==id){index=i;break;}
                    if(index<0||CosmeticsManager.CosmeticElementsList[index] is not ClothingCosmeticElement clothing)
                        throw new InvalidOperationException("Unknown clothing ID");
                    foreach(var target in clothing.ReplaceItemsId.Concat(clothing.ReplaceItemless.Where(t=>t.Item1==choice.Key).Select(t=>t.Item2)))
                        if(!targets.Add(target))throw new InvalidOperationException("Conflicting cosmetics");
                    selected.Add(index);
                }
                // Preserve native emotes and any non-clothing cosmetic selection.
                if(result.TryGetValue(classIndex,out var original))selected.AddRange(original.Where(i=>i>=0&&i<CosmeticsManager.CosmeticElementsList.Count&&CosmeticsManager.CosmeticElementsList[i] is not ClothingCosmeticElement));
                result[classIndex]=selected;
            }
            player.UsedCosmetics=result;saved.Applied=result;saved.Signature=signature;
            SubModule.Log("Armory applied to connection; configured classes="+choices.Count);
        }
    }
}
