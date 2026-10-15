using ArenaBridge;
using TaleWorlds.MountAndBlade;
using TaleWorlds.MountAndBlade.ListedServer;

// Exercise the production preparation state machine without loading the game engine.
internal static class PreparationChecks
{
    public static void Run()
    {
        var dir=Path.Combine(Path.GetTempPath(),"hymm-preparation-"+Guid.NewGuid());
        Directory.CreateDirectory(dir);
        var retirementClock=MissionRetirement.Now;
        try
        {
            using var link=new Transport(new Config{Token=new string('x',40)},Path.Combine(dir,"state.json"),_=>{});
            SubModule.Link=link;
            var manager=ServerSideIntermissionManager.Instance;
            var votes=MultiplayerIntermissionVotingManager.Instance;
            var job=new Job{MatchId="preparation-test",Mode="Skirmish",Map="mp_skirmish_map_010",RoundsToWin=3,
                Cultures=new[]{"battania","sturgia"},Teams=Enumerable.Range(0,12).Select(i=>(76561198000000000L+i).ToString()).Chunk(6).ToArray()};
            void Check(bool ok,string reason){if(!ok)throw new Exception("Preparation: "+reason);}
            Check(!Policy.IdleMapPool(link.Config,new[]{"mp_skirmish_spawn_test","mp_skirmish_map_010"},Array.Empty<string>()).Contains("mp_skirmish_spawn_test"),"developer scenes excluded from idle rotation");
            var customConfig=new Config{IdleMaps=new[]{"mp_bnl_lighthouse"}};
            Check(Policy.IdleMapPool(customConfig,Array.Empty<string>(),Array.Empty<string>()).Length==0,"unregistered custom scene not selected");
            Check(Policy.IdleMapPool(customConfig,Array.Empty<string>(),new[]{"mp_bnl_lighthouse"}).Single()=="mp_bnl_lighthouse","registered custom scene available for idle only");
            Check(Policy.SupportsRankedMap("mp_bnl_lighthouse",Array.Empty<string>(),new[]{"mp_bnl_lighthouse"}),"Skirmish-registered custom map can host ranked games");
            Check(!Policy.SupportsRankedMap("unknown_custom",Array.Empty<string>(),new[]{"mp_bnl_lighthouse"}),"unregistered custom map remains rejected");

            // Real incident: native scenes contain the map, explicit voting list is empty.
            Check(votes.GetUsableMaps("Skirmish").Count==0,"empty voting fixture");
            Mission.Current=null;
            link.State.Active=job;
            Preparation.Begin(job,link);Preparation.Tick();
            Check(manager.Starts==1&&link.State.Outbox.Count==0,"installed map starts without a voting pool");
            Check(MultiplayerOptions.Values[MultiplayerOptions.OptionType.Map].Equals(job.Map),"selected map reaches native options");
            Check(MultiplayerOptions.Values[MultiplayerOptions.OptionType.RoundTimeLimit].Equals(420),"Skirmish uses native seven-minute round duration");
            Check(MultiplayerOptions.Values[MultiplayerOptions.OptionType.CultureTeam1].Equals("battania")&&
                  MultiplayerOptions.Values[MultiplayerOptions.OptionType.CultureTeam2].Equals("sturgia"),"distinct cultures preserved");
            Check(!votes.IsMapVoteEnabled&&!votes.IsCultureVoteEnabled,"no voting enabled");
            Check(link.Config.ArrivalTimeoutSeconds==300&&MultiplayerOptions.Values[MultiplayerOptions.OptionType.WarmupTimeLimitInSeconds].Equals(300),"arrival and native warmup both use five minutes");
            // A real map takes longer than the two-second poll interval to reach AfterStart.
            Thread.Sleep(2100);Preparation.Tick();Preparation.Tick();
            Check(manager.Starts==1&&manager.Ends==0&&link.State.Outbox.Count==0&&Preparation.HasPending,
                  "loading mission must retain roster until delayed AfterStart, without another start or failure");
            Check(Preparation.Adopt(link)==job&&!Preparation.HasPending,"new mission adopts the prepared job");

            var prior=Mission.Current;
            job.Map="missing_scene";
            Preparation.Begin(job,link);Preparation.Tick();
            Check(link.State.Outbox.Single().Reason=="unsupported_skirmish_map","unknown map fails with a precise reason");
            Check(manager.Starts==1&&manager.Ends==0&&Mission.Current==prior,"invalid map does not retire existing mission");
            link.State.Outbox.Clear();
            job.Map="mp_skirmish_map_010";job.Cultures=new[]{"empire","empire"};
            Preparation.Begin(job,link);Preparation.Tick();
            Check(link.State.Outbox.Single().Reason=="invalid_match_job","mirror cultures still rejected");
            Check(manager.Ends==0,"invalid job leaves the existing mission intact");
            link.State.Outbox.Clear();job.Cultures=new[]{"battania","sturgia"};Mission.Current=null;
            manager.DeferStart=true;Preparation.Begin(job,link);Preparation.Tick();
            Thread.Sleep(2100);Preparation.Tick();
            Check(manager.Starts==2&&Preparation.HasPending&&Preparation.Adopt(link)==null,"pending native startup with no current mission is not restarted or adopted early");
            Preparation.Abort();Mission.Current=new();
            Check(Preparation.Adopt(link)==null,"late AfterStart cannot revive an administratively aborted roster");
            manager.DeferStart=false;
            link.State.Active=null;link.State.Outbox.Clear();Mission.Current=null;
            Check(Preparation.CanPlayIdle(link),"unreserved healthy server permits free play");
            link.State.Blocked="review";Check(!Preparation.CanPlayIdle(link),"blocked server never admits free play");link.State.Blocked=null;
            manager.ListedServer.IsPlaying=false;Preparation.StartIdle();
            Check(manager.Starts==2,"idle waits for native game registration before requesting a mission");
            manager.ListedServer.IsPlaying=true;Preparation.StartIdle();
            Check(manager.Starts==3&&Mission.Current!=null,"idle server loads a real mission");
            Check(MultiplayerOptions.Values[MultiplayerOptions.OptionType.WarmupTimeLimitInSeconds].Equals(120),"free play warmup uses two minutes");
            Check(GameNetwork.Messages.TakeLast(3).Select(m=>m.GetType().Name).SequenceEqual(new[]{"MultiplayerOptionsInitial","MultiplayerOptionsImmediate","LoadMission"}),"idle mission sends options before client load");
            Check(MultiplayerOptions.Values[MultiplayerOptions.OptionType.MinNumberOfPlayersForMatchStart].Equals(2),"idle allows ordinary small games");
            Check(!MultiplayerOptions.Values[MultiplayerOptions.OptionType.CultureTeam1].Equals(MultiplayerOptions.Values[MultiplayerOptions.OptionType.CultureTeam2]),"idle nations are distinct");
            Preparation.StartIdle();Check(manager.Starts==3,"idle startup is not duplicated");
            link.State.Active=job;Preparation.Begin(job,link);Preparation.Tick();
            Check(manager.Ends==1&&!Preparation.CanPlayIdle(link),"ranked reservation retires idle play and locks teams");
            Thread.Sleep(2100);Preparation.Tick();
            Check(manager.Starts==4&&Preparation.Adopt(link)==job,"ranked mission loads fresh after idle play");
            Check(link.Config.ArrivalTimeoutSeconds==300&&MultiplayerOptions.Values[MultiplayerOptions.OptionType.WarmupTimeLimitInSeconds].Equals(300),"ranked restores five minute warmup after free play");
            Check(MultiplayerOptions.Values[MultiplayerOptions.OptionType.MinNumberOfPlayersForMatchStart].Equals(13),"ranked startup still waits for authorized roster");
            job.Map="mp_bnl_lighthouse";votes.CustomMaps.Add(job.Map);Mission.Current=null;
            Preparation.Begin(job,link);Preparation.Tick();
            Check(manager.Starts==5&&Preparation.Adopt(link)==job,"custom ranked map passes production preparation and adoption");
            var command=new StopCommand{Id="idle-test",Type="idle-map",Map="mp_bnl_lighthouse",ExpiresAt=DateTimeOffset.UtcNow.AddMinutes(3).ToUnixTimeMilliseconds()};
            Preparation.SwitchIdle(link,command);
            Check(link.State.ControlError=="server_busy"&&manager.Ends==1,"manual map refuses active ranked state without ending mission");
            link.State.Active=null;command.Id="idle-valid";
            Preparation.SwitchIdle(link,command);Check(manager.Ends==2,"manual switch retires previous idle mission");
            Thread.Sleep(2100);Preparation.SwitchIdle(link,command);
            Check(manager.Starts==6&&link.State.LastControlId!="idle-valid","manual map waits for mission initialization before success");
            Mission.Current!.Behaviors[typeof(ArenaBehavior)]=new ArenaBehavior{Initialized=false};
            Preparation.SwitchIdle(link,command);
            Check(link.State.LastControlId!="idle-valid","registered behavior alone is not a loaded mission");
            Mission.Current.GetMissionBehavior<ArenaBehavior>()!.Initialized=true;
            Mission.Current.CurrentState=Mission.State.Initializing;
            Preparation.SwitchIdle(link,command);
            Check(link.State.LastControlId!="idle-valid","initializing mission cannot acknowledge map success");
            Mission.Current.CurrentState=Mission.State.Continuing;
            Preparation.SwitchIdle(link,command);
            Check(link.State.LastControlId=="idle-valid"&&link.State.ControlResult=="ok"&&link.CurrentMap==command.Map,"manual custom map acknowledged only after load");
            command.Id="bad-map";command.Map="not_installed";Preparation.SwitchIdle(link,command);
            Check(link.State.ControlError=="unsupported_map"&&manager.Ends==2,"invalid manual map leaves idle mission intact");
            command.Id="expired";command.ExpiresAt=0;Preparation.SwitchIdle(link,command);
            Check(link.State.ControlError=="command_expired"&&manager.Ends==2,"expired command cannot change maps");
            command.Id="empty-warmup";command.Map="mp_bnl_lighthouse";command.ExpiresAt=DateTimeOffset.UtcNow.AddMinutes(3).ToUnixTimeMilliseconds();
            manager.DeferEnd=true;var emptyWarmup=Mission.Current;
            emptyWarmup!.Behaviors[typeof(MissionLobbyComponent)]=new MissionLobbyComponent{CurrentMultiplayerState=MissionLobbyComponent.MultiplayerGameState.Ending};
            var endTimer=new MultiplayerTimerComponent{Duration=15};emptyWarmup.Behaviors[typeof(MultiplayerTimerComponent)]=endTimer;
            GameNetwork.Messages.Clear();
            Preparation.SwitchIdle(link,command);
            Check(Mission.Current==emptyWarmup&&manager.Ends==3,"native warmup ending may be delayed");
            Check(!Preparation.CanSelectTeam(emptyWarmup!),"manual transition rejects team operations");
            var flags=System.Reflection.BindingFlags.NonPublic|System.Reflection.BindingFlags.Static;
            double clock=retirementClock()+20;MissionRetirement.Now=()=>clock;
            typeof(Preparation).GetField("manualRetry",flags)!.SetValue(null,DateTime.MinValue);
            Preparation.SwitchIdle(link,command);
            Check(Mission.Current==emptyWarmup&&manager.Ends==3&&endTimer.Duration==0,"fallback only expires native ending timer and leaves scene alive until network tick");
            Check(GameNetwork.Messages.Count==0,"application tick must not send unload, desynchronize peers or tear down scene");
            command.Id="expire-transition";command.ExpiresAt=0;Preparation.SwitchIdle(link,command);
            Mission.Current=new();
            Check(Preparation.CanSelectTeam(Mission.Current),"stable mission allows team requests");
            Mission.Current.Behaviors[typeof(MissionLobbyComponent)]=new MissionLobbyComponent{CurrentMultiplayerState=MissionLobbyComponent.MultiplayerGameState.Ending};
            Check(!Preparation.CanSelectTeam(Mission.Current),"results screen rejects team operations without a map command");
            manager.DeferEnd=false;
            // Incident #37: an existing free-play round replaces the shared lobby
            // shutdown timer. A reservation must not sit for 120 seconds or send
            // UnloadMission from the application tick to work around it.
            manager.DeferEnd=true;link.State.Active=job;link.State.Outbox.Clear();
            Mission.Current=new();var rankedPrevious=Mission.Current;
            var rankedLobby=new MissionLobbyComponent{CurrentMultiplayerState=MissionLobbyComponent.MultiplayerGameState.Ending};
            var rankedTimer=new MultiplayerTimerComponent{Duration=420};
            rankedPrevious.Behaviors[typeof(MissionLobbyComponent)]=rankedLobby;
            rankedPrevious.Behaviors[typeof(MultiplayerTimerComponent)]=rankedTimer;
            int endsBefore=manager.Ends,startsBefore=manager.Starts;
            GameNetwork.Messages.Clear();Preparation.Begin(job,link);Preparation.Tick();
            typeof(Preparation).GetField("nextAttempt",flags)!.SetValue(null,DateTime.MinValue);Preparation.Tick();
            Check(manager.Ends==endsBefore+1&&rankedTimer.Duration==420,"ranked shutdown requested once; normal post-match wait retained");
            clock+=20;
            typeof(Preparation).GetField("nextAttempt",flags)!.SetValue(null,DateTime.MinValue);Preparation.Tick();
            Check(rankedTimer.Duration==0&&Mission.Current==rankedPrevious&&Preparation.HasPending&&link.State.Outbox.Count==0,"ranked reservation expires overwritten timer without losing roster");
            Check(manager.Starts==startsBefore&&manager.Ends==endsBefore+1&&GameNetwork.Messages.Count==0,"no premature mission load, direct unload or repeated shutdown requests");
            rankedTimer.Duration=420;
            clock+=2;
            typeof(Preparation).GetField("nextAttempt",flags)!.SetValue(null,DateTime.MinValue);Preparation.Tick();
            Check(rankedTimer.Duration==0,"later round timer overwrite also recovers");
            Mission.Current=null; // Native network tick finishes shutdown.
            typeof(Preparation).GetField("nextAttempt",flags)!.SetValue(null,DateTime.MinValue);Preparation.Tick();
            Check(manager.Starts==startsBefore+1&&Preparation.Adopt(link)==job,"ranked map starts and adopts the same roster after native cleanup");
            Check(MultiplayerOptions.Values[MultiplayerOptions.OptionType.WarmupTimeLimitInSeconds].Equals(300),"recovery retains ranked five-minute arrival window");
            MissionRetirement.Tick(); // Observe that the native mission was replaced.
            Mission.Current=rankedPrevious;rankedLobby.CurrentMultiplayerState=MissionLobbyComponent.MultiplayerGameState.Playing;rankedTimer.Duration=420;
            Preparation.Begin(job,link);Preparation.Tick();
            clock+=20;
            typeof(Preparation).GetField("nextAttempt",flags)!.SetValue(null,DateTime.MinValue);Preparation.Tick();
            Check(rankedTimer.Duration==420&&link.State.Outbox.Single().Reason=="native_shutdown_unavailable","never expire an actively playing lobby timer");
            link.State.Outbox.Clear();
            // All three callers must move players through the native selector before
            // ending a scene; cancellation must retain the existing retirement clock.
            Mission.Current=new();var spectatorMission=Mission.Current;
            var arena=new ArenaBehavior();var selector=new MultiplayerTeamSelectComponent();
            var spectatorTimer=new MultiplayerTimerComponent{Duration=420};
            spectatorMission.Behaviors[typeof(ArenaBehavior)]=arena;
            spectatorMission.Behaviors[typeof(MultiplayerTeamSelectComponent)]=selector;
            spectatorMission.Behaviors[typeof(MissionLobbyComponent)]=new MissionLobbyComponent{CurrentMultiplayerState=MissionLobbyComponent.MultiplayerGameState.Ending};
            spectatorMission.Behaviors[typeof(MultiplayerTimerComponent)]=spectatorTimer;
            GameNetwork.NetworkPeers.Clear();GameNetwork.Messages.Clear();
            var a=new NetworkCommunicator{Player=new(){Team=spectatorMission.AttackerTeam,ControlledAgent=new()}};
            var b=new NetworkCommunicator{Player=new(){Team=spectatorMission.DefenderTeam,ControlledAgent=new()}};
            var observer=new NetworkCommunicator{Player=new(){Team=spectatorMission.SpectatorTeam}};
            var loading=new NetworkCommunicator{IsSynchronized=false,Player=new(){Team=spectatorMission.AttackerTeam}};
            GameNetwork.NetworkPeers.AddRange(new[]{a,b,observer,loading});
            selector.BeforeChange=()=>Check(arena.Retiring&&!Preparation.CanSelectTeam(spectatorMission),"scoring and team requests disabled before native team-switch callbacks");
            manager.BeforeEnd=()=>Check(a.Player.Team==spectatorMission.SpectatorTeam&&b.Player.Team==spectatorMission.SpectatorTeam,"both combat sides moved before native end request");
            endsBefore=manager.Ends;link.State.Active=job;Preparation.Begin(job,link);Preparation.Tick();
            Check(selector.Changes==2&&manager.Ends==endsBefore+1&&a.Player.ControlledAgent==null&&b.Player.ControlledAgent==null,"native spectator switch removes living agents; existing observers skipped");
            loading.IsSynchronized=true;clock+=2;MissionRetirement.Tick();
            Check(loading.Player.Team==spectatorMission.SpectatorTeam&&selector.Changes==3,"late synchronized peers also moved to spectator");
            var stop=new StopCommand{Id="stop-during-preparation",MatchId=job.MatchId,Type="stop"};
            typeof(Transport).GetField("<Control>k__BackingField",System.Reflection.BindingFlags.Instance|System.Reflection.BindingFlags.NonPublic)!.SetValue(link,stop);
            Operations.Tick();
            Check(!Preparation.HasPending&&link.Control==stop&&manager.Ends==endsBefore+1,"cancel reuses pending retirement without resending end or acknowledging early");
            clock+=20;Operations.Tick();
            Check(spectatorTimer.Duration==0&&Mission.Current==spectatorMission,"cancel also recovers overwritten ending timer");
            Check(!GameNetwork.Messages.Any(m=>m is NetworkMessages.FromServer.UnloadMission or DesynchronizeMarker or LobbyEndMarker),"spectator flow never forcibly unloads or desynchronizes clients");
            Mission.Current=null;Operations.Tick();MissionRetirement.Tick();
            Check(link.Control==null&&link.State.Active==null&&link.State.LastControlId==stop.Id,"cancel releases server only after native scene exit");
            Mission.Current=new();var untouched=Mission.Current;
            link.State.Active=job;stop=new StopCommand{Id="wrong-match",MatchId="another-match",Type="stop"};
            typeof(Transport).GetField("<Control>k__BackingField",System.Reflection.BindingFlags.Instance|System.Reflection.BindingFlags.NonPublic)!.SetValue(link,stop);
            endsBefore=manager.Ends;Operations.Tick();
            Check(manager.Ends==endsBefore&&!MissionRetirement.IsRetiring(untouched),"stop for another match cannot spectate or retire current players");
            typeof(Transport).GetField("<Control>k__BackingField",System.Reflection.BindingFlags.Instance|System.Reflection.BindingFlags.NonPublic)!.SetValue(link,null);
            link.State.Active=null;
            manager.BeforeEnd=null;manager.DeferEnd=false;GameNetwork.NetworkPeers.Clear();
            Console.WriteLine("Preparation regression checks passed");
        }
        finally{Preparation.Abort();SubModule.Link=null;Mission.Current=null;MissionRetirement.Tick();MissionRetirement.Now=retirementClock;GameNetwork.NetworkPeers.Clear();Directory.Delete(dir,true);}
    }
}

namespace ArenaBridge
{
    internal static class SubModule {internal static Transport? Link;internal static void Log(string message){} }
    internal static class Recovery {public static bool HasPending=>false;}
    internal sealed class ArenaBehavior {public bool Retiring;public bool FreePlay=>!Retiring;public bool Initialized=true;public void BeginRetirement(){Retiring=true;}public bool StopByAdmin(string matchId){BeginRetirement();return true;}}
}
namespace TaleWorlds.MountAndBlade
{
    public sealed class Mission {
        public static Mission? Current;
        public enum State {Initializing,Continuing,EndingNextFrame}
        public State CurrentState=State.Continuing;
        public bool MissionEnded;
        public readonly Dictionary<Type,object> Behaviors=new();
        public Team AttackerTeam=new(TaleWorlds.Core.BattleSideEnum.Attacker),DefenderTeam=new(TaleWorlds.Core.BattleSideEnum.Defender);
        public Team SpectatorTeam=new(TaleWorlds.Core.BattleSideEnum.None);
        public T? GetMissionBehavior<T>() where T:class=>Behaviors.GetValueOrDefault(typeof(T)) as T;
        public int Resets;
        public Action? ResetFault;
        public void ResetMission(){Resets++;foreach(var p in GameNetwork.NetworkPeers)p.Player.ControlledAgent=null;ResetFault?.Invoke();}
        public void EndMission(){Current=null;}
    }
    public sealed class MissionLobbyComponent {
        public static readonly float PostMatchWaitDuration=15;
        public enum MultiplayerGameState {Playing,Ending}
        public MultiplayerGameState CurrentMultiplayerState;
    }
    public sealed class MultiplayerTeamSelectComponent {
        public int Changes;public Action? BeforeChange;
        public void ChangeTeamServer(NetworkCommunicator peer,Team team){BeforeChange?.Invoke();Changes++;peer.Player.ControlledAgent=null;peer.Player.Team=team;}
    }
    public sealed class DesynchronizeMarker {}
    public sealed class LobbyEndMarker {}
    public static class BannerlordNetwork {
        public static void EndMultiplayerLobbyMission(){GameNetwork.Messages.Add(new LobbyEndMarker());Mission.Current?.EndMission();}
    }
    public sealed class MultiplayerRoundController {
        public bool IsMatchEnding;public MultiplayerRoundState CurrentRoundState;public int RoundCount;
        public TaleWorlds.Core.BattleSideEnum RoundWinner;public RoundEndReason RoundEndReason;
    }
    public static class GameNetwork
    {
        public static bool IsServer=true;
        public static readonly List<NetworkCommunicator> NetworkPeers=new();
        public static readonly List<object> Messages=new();
        public enum EventBroadcastFlags {None,IncludeUnsynchronizedClients}
        public static void UnSynchronizeEveryone(){Messages.Add(new DesynchronizeMarker());}
        public static void BeginBroadcastModuleEvent(){}
        public static void WriteMessage(object message)=>Messages.Add(message);
        public static void EndBroadcastModuleEvent(EventBroadcastFlags flags){}
    }
    public static class MultiplayerGameTypes
    {
        public sealed class Info {public string[] Scenes={"mp_skirmish_map_002f","mp_skirmish_map_010"};}
        public static Info GetGameTypeInfo(string mode)=>mode=="Skirmish"?new():throw new Exception("Unexpected game mode");
    }
    public sealed class MultiplayerIntermissionVotingManager
    {
        public static readonly MultiplayerIntermissionVotingManager Instance=new();
        public bool IsAutomatedBattleSwitchingEnabled,IsDisableMapVoteOverride,IsDisableCultureVoteOverride;
        public bool IsMapVoteEnabled=true,IsCultureVoteEnabled=true;
        public List<string> CustomMaps=new();
        public List<string> GetUsableMaps(string mode)=>mode=="Skirmish"?CustomMaps:new();
    }
    public sealed class MultiplayerOptions
    {
        public static readonly MultiplayerOptions Instance=new();
        public int GetRoundTimeLimitInMinutesForGameMode(string mode)=>mode=="Skirmish"?7:throw new Exception("Unexpected mode");
        public enum OptionType {GameType,Map,CultureTeam1,CultureTeam2,RoundTotal,RoundTimeLimit,MinNumberOfPlayersForMatchStart,NumberOfBotsTeam1,NumberOfBotsTeam2,WarmupTimeLimitInSeconds}
        public static readonly Dictionary<OptionType,object> Values=new();
    }
    public static class TestOptionExtensions
    {
        public static void SetValue(this MultiplayerOptions.OptionType option,object value)=>MultiplayerOptions.Values[option]=value;
        public static string GetStrValue(this MultiplayerOptions.OptionType option)=>MultiplayerOptions.Values.GetValueOrDefault(option)?.ToString()??"";
    }
}
namespace TaleWorlds.MountAndBlade.ListedServer
{
    public sealed class ServerSideIntermissionManager
    {
        public static readonly ServerSideIntermissionManager Instance=new();
        public int Starts,Ends;
        public bool DeferStart,DeferEnd;public Action? BeforeEnd;
        public sealed class ServerState {public bool IsRegistered=true,IsPlaying=true;}
        public ServerState ListedServer=new();
        public string[] UsableMaps=Array.Empty<string>();
        public void StartMission(){Starts++;GameNetwork.Messages.Add(new NetworkMessages.FromServer.LoadMission());if(!DeferStart)Mission.Current=new();}
        public void EndMission(){BeforeEnd?.Invoke();Ends++;if(!DeferEnd)Mission.Current=null;}
    }
}
namespace NetworkMessages.FromServer
{
    public sealed class MultiplayerOptionsInitial{}
    public sealed class MultiplayerOptionsImmediate{}
    public sealed class UnloadMission{}
    public sealed class LoadMission{}
}
