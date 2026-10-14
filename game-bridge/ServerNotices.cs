using System.Diagnostics;
using TaleWorlds.MountAndBlade;
using NetworkMessages.FromServer;

namespace ArenaBridge;

internal sealed class ServerNotices : MissionBehavior
{
    // Network peers survive map changes; a fresh connection gets the notice again.
    static readonly HashSet<NetworkCommunicator> welcomed=new();
    static readonly HashSet<NetworkCommunicator> announced=new();
    readonly Dictionary<NetworkCommunicator,(int line,double due)> pending=new();
    readonly string[] messages;
    public ServerNotices(Config config){messages=config.JoinMessages;}
    public override MissionBehaviorType BehaviorType=>MissionBehaviorType.Other;
    internal static double Now=>Stopwatch.GetTimestamp()/(double)Stopwatch.Frequency;
    public override void OnMissionTick(float dt)
    {
        if(!Preparation.CanSelectTeam(Mission))return;
        var peers=GameNetwork.NetworkPeers.Where(p=>!p.IsServerPeer).ToArray();
        welcomed.RemoveWhere(p=>!peers.Contains(p));
        announced.RemoveWhere(p=>!peers.Contains(p));
        foreach(var p in pending.Keys.ToArray())if(!peers.Contains(p))pending.Remove(p);
        foreach(var peer in peers)
        {
            if(!peer.IsSynchronized||peer.GetComponent<MissionPeer>()==null||welcomed.Contains(peer))continue;
            if(!pending.TryGetValue(peer,out var next)){pending[peer]=(0,Now+5);continue;}
            if(Now<next.due)continue;
            // Track the broadcast separately from private notices so a map
            // transition during the notice sequence does not announce twice.
            if(announced.Add(peer))Broadcast($"[HYMM] 欢迎 {SafeName(peer.GetComponent<MissionPeer>().Name)} 加入服务器！");
            if(next.line>=messages.Length){welcomed.Add(peer);pending.Remove(peer);continue;}
            GameNetwork.BeginModuleEventAsServer(peer);
            GameNetwork.WriteMessage(new ServerMessage(messages[next.line]));
            GameNetwork.EndModuleEventAsServer();
            pending[peer]=(next.line+1,Now+3);
        }
    }
    internal static void BroadcastStreak(string name,int count)
    {
        Broadcast($"[HYMM] {SafeName(name)} 达成 {count} 连杀！");
    }
    static string SafeName(string name)
    {
        // Player names cannot inject extra lines or rich-text markup into the notice.
        var safe=new string(name.Where(c=>!char.IsControl(c)&&c!='<'&&c!='>').Take(40).ToArray());
        return string.IsNullOrWhiteSpace(safe)?"玩家":safe;
    }
    static void Broadcast(string text)
    {
        GameNetwork.BeginBroadcastModuleEvent();
        GameNetwork.WriteMessage(new ServerMessage(text));
        GameNetwork.EndBroadcastModuleEvent(GameNetwork.EventBroadcastFlags.None);
    }
}
