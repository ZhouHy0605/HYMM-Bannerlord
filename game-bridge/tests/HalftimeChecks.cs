using ArenaBridge;
using TaleWorlds.Core;
using TaleWorlds.MountAndBlade;
using TaleWorlds.MountAndBlade.ListedServer;

internal static class HalftimeChecks
{
    public static void Run()
    {
        void Check(bool ok,string text){if(!ok)throw new Exception("Halftime: "+text);}
        var mission=new Mission();Mission.Current=mission;
        var rounds=new MultiplayerRoundController{RoundCount=6,CurrentRoundState=MultiplayerRoundState.Ended,RoundWinner=BattleSideEnum.Attacker};
        var board=new MissionScoreboardComponent();board.Scores[BattleSideEnum.Attacker]=3;board.Scores[BattleSideEnum.Defender]=2;
        var timer=new MultiplayerTimerComponent();var mode=new MissionMultiplayerFlagDomination();
        foreach(var item in new object[]{rounds,board,timer,mode})mission.Behaviors[item.GetType()]=item;
        var manager=ServerSideIntermissionManager.Instance;int starts=manager.Starts,ends=manager.Ends;
        GameNetwork.NetworkPeers.Clear();GameNetwork.Messages.Clear();
        for(int i=0;i<12;i++)GameNetwork.NetworkPeers.Add(new(){Player=new(){Team=i<6?mission.AttackerTeam:mission.DefenderTeam,Gold=380,KillCount=i+1,DeathCount=i,AssistCount=i+2,Score=100+i,ControlledAgent=new()}});
        var spectator=new NetworkCommunicator{Player=new(){Team=new(BattleSideEnum.None),Gold=17}};GameNetwork.NetworkPeers.Add(spectator);
        NativeHalftime.Hold(mission);
        Check(timer.Duration==86400&&mission.Resets==0&&board.GetRoundScore(BattleSideEnum.Attacker)==3&&GameNetwork.NetworkPeers[0].Player.ControlledAgent!=null,"persistence hold changes only round timer, not scores, sides or agents");
        NativeHalftime.Reset(mission,()=>{
            Check(GameNetwork.NetworkPeers.All(p=>p.Player.ControlledAgent==null),"remove live agents through round cleanup before any side change, no suicide path");
            foreach(var peer in GameNetwork.NetworkPeers.Take(12))peer.Player.Team=peer.Player.Team==mission.AttackerTeam?mission.DefenderTeam:mission.AttackerTeam;
        });
        Check(Mission.Current==mission&&manager.Starts==starts&&manager.Ends==ends,"does not reload scene or enter server lobby");
        Check(board.Scores.Values.All(x=>x==0)&&rounds.RoundCount==0&&rounds.RoundWinner==BattleSideEnum.None,"both scores and leg round counter reset");
        Check(!rounds.IsMatchEnding&&rounds.CurrentRoundState==MultiplayerRoundState.Ended&&timer.Duration==86400,"hold round progression until HTTP confirmation");
        Check(GameNetwork.NetworkPeers.Take(6).All(p=>p.Player.Team==mission.DefenderTeam)&&GameNetwork.NetworkPeers.Skip(6).Take(6).All(p=>p.Player.Team==mission.AttackerTeam),"12 players exchange physical sides");
        Check(GameNetwork.NetworkPeers.Take(12).All(p=>p.Player.Gold==300)&&spectator.Player.Gold==17,"equal new-half gold, spectator untouched");
        Check(GameNetwork.NetworkPeers.Take(12).Select((p,i)=>p.Player.KillCount==i+1&&p.Player.DeathCount==i&&p.Player.AssistCount==i+2&&p.Player.Score==100+i).All(x=>x),"cumulative kills/deaths/assists/personal score survive halftime");
        Check(mission.Resets==1&&GameNetwork.Messages.OfType<NetworkMessages.FromServer.KillDeathCountChange>().Count()==13,"one normal round cleanup and score refresh for everyone");
        Check(GameNetwork.Messages.OfType<NetworkMessages.FromServer.ServerMessage>().Count()==1,"in-game halftime notice");
        NativeHalftime.Resume(mission);Check(timer.Duration==5,"resume through normal preparation after short countdown");
        // A future native/mod hook that changes totals during cleanup must not leak
        // synthetic deaths, suicide penalties or assists into personal totals.
        mission.ResetFault=()=>{foreach(var p in GameNetwork.NetworkPeers){p.Player.DeathCount++;p.Player.AssistCount++;p.Player.Score-=30;}};
        NativeHalftime.Reset(mission,()=>{});
        Check(GameNetwork.NetworkPeers.Take(12).Select((p,i)=>p.Player.DeathCount==i&&p.Player.AssistCount==i+2&&p.Player.Score==100+i).All(x=>x),"synthetic transition stat changes are restored");
        rounds.IsMatchEnding=true;
        try{NativeHalftime.Reset(mission,()=>throw new Exception("must not swap"));throw new Exception("accepted ended mission");}catch(Exception e)when(e.Message=="invalid_halftime_state"){}
        try{NativeHalftime.Resume(mission);throw new Exception("resumed ended mission");}catch(Exception e)when(e.Message=="invalid_halftime_resume"){}
        Mission.Current=null;GameNetwork.NetworkPeers.Clear();GameNetwork.Messages.Clear();
        Console.WriteLine("In-place halftime native-adapter checks passed");
    }
}
namespace TaleWorlds.Core {public enum BattleSideEnum {None=-1,Defender=0,Attacker=1}}
namespace TaleWorlds.MountAndBlade
{
    public enum MultiplayerRoundState {Ended,InProgress}
    public enum RoundEndReason {Invalid}
    public sealed class Team {public BattleSideEnum Side;public Team(BattleSideEnum side){Side=side;}}
    public sealed class MissionPeer {public Team? Team;public int Gold;public int KillCount{get;internal set;}public int DeathCount{get;internal set;}public int AssistCount{get;internal set;}public int Score{get;internal set;}public object? ControlledAgent;public NetworkCommunicator GetNetworkPeer()=>GameNetwork.NetworkPeers.Single(p=>p.Player==this);}
    public sealed class NetworkCommunicator {public bool IsServerPeer;public bool IsSynchronized=true;public MissionPeer Player=new();public T? GetComponent<T>() where T:class=>Player as T;}
    public sealed class MissionScoreboardComponent {
        public Dictionary<BattleSideEnum,int> Scores=new();
        public int GetRoundScore(BattleSideEnum side)=>Scores.GetValueOrDefault(side);
        public void ChangeTeamScore(Team team,int delta)=>Scores[team.Side]=GetRoundScore(team.Side)+delta;
        public void PlayerPropertiesChanged(NetworkCommunicator peer){}
    }
    public sealed class MultiplayerTimerComponent {public float Duration;public void StartTimerAsServer(float value)=>Duration=value;}
    public sealed class MissionMultiplayerFlagDomination {
        public const int DefaultGoldAmountForTroopSelectionForSkirmish=300;
        public void ChangeCurrentGoldForPeer(MissionPeer peer,int gold)=>peer.Gold=gold;
    }
}
namespace NetworkMessages.FromServer {
    public sealed class ServerMessage {public string Text;public ServerMessage(string text){Text=text;}}
    public sealed class KillDeathCountChange {public KillDeathCountChange(NetworkCommunicator peer,NetworkCommunicator? attacker,int kills,int assists,int deaths,int score){}}
}
