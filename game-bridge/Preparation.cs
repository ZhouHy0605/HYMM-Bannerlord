using TaleWorlds.MountAndBlade;
using TaleWorlds.MountAndBlade.ListedServer;
using NetworkMessages.FromServer;

namespace ArenaBridge;

// All native mission/option operations stay on the application thread.
internal static class Preparation
{
    internal const int IdleWarmupSeconds = 120;
    static Job? pending;
    static Transport? owner;
    static Mission? previous;
    static Task<Job?>? claiming;
    static bool startRequested;
    static DateTime rankedEndRequested;
    static bool rankedEndTimerLogged;
    static bool idleStarting;
    static DateTime idleDeadline;
    static DateTime deadline,nextAttempt,nextPoll;
    static string? manualId;
    static Mission? manualPrevious;
    static bool manualStarted;
    static DateTime manualEndRequested;
    static DateTime manualDeadline,manualRetry;
    public static bool HasPending=>pending!=null||claiming!=null;
    internal static bool CanSelectTeam(Mission mission)=>Mission.Current==mission&&mission.CurrentState==Mission.State.Continuing&&!mission.MissionEnded&&
        mission.GetMissionBehavior<MissionLobbyComponent>()?.CurrentMultiplayerState!=MissionLobbyComponent.MultiplayerGameState.Ending&&
        manualId==null&&pending==null&&SubModule.Link?.Control==null;
    public static bool CanPlayIdle(Transport link)=>link.State.Active==null&&link.State.Outbox.Count==0&&link.State.Blocked==null&&link.Control==null&&pending==null;
    internal static void StartIdle(string? selectedMap=null)
    {
        var manager=ServerSideIntermissionManager.Instance;
        if(manager==null||!manager.ListedServer.IsRegistered||!manager.ListedServer.IsPlaying||Mission.Current!=null||idleStarting)return;
        var config=SubModule.Link?.Config;if(config==null)return;
        var maps=Policy.IdleMapPool(config,MultiplayerGameTypes.GetGameTypeInfo("Skirmish").Scenes,manager.UsableMaps);
        if(selectedMap!=null){if(!Policy.SupportsRankedMap(selectedMap,MultiplayerGameTypes.GetGameTypeInfo("Skirmish").Scenes,MultiplayerIntermissionVotingManager.Instance.GetUsableMaps("Skirmish")))throw new Exception("unsupported_map");maps=new[]{selectedMap};}
        if(maps.Length==0)return;
        var votes=MultiplayerIntermissionVotingManager.Instance;
        votes.IsMapVoteEnabled=false;votes.IsCultureVoteEnabled=false;
        votes.IsDisableMapVoteOverride=true;votes.IsDisableCultureVoteOverride=true;
        int culture=Random.Shared.Next(Policy.Cultures.Length);
        MultiplayerOptions.OptionType.GameType.SetValue("Skirmish");
        MultiplayerOptions.OptionType.Map.SetValue(maps[Random.Shared.Next(maps.Length)]);
        MultiplayerOptions.OptionType.CultureTeam1.SetValue(Policy.Cultures[culture]);
        MultiplayerOptions.OptionType.CultureTeam2.SetValue(Policy.Cultures[(culture+Random.Shared.Next(1,Policy.Cultures.Length))%Policy.Cultures.Length]);
        MultiplayerOptions.OptionType.MinNumberOfPlayersForMatchStart.SetValue(2);
        MultiplayerOptions.OptionType.WarmupTimeLimitInSeconds.SetValue(IdleWarmupSeconds);
        MultiplayerOptions.OptionType.RoundTotal.SetValue(5);
        MultiplayerOptions.OptionType.RoundTimeLimit.SetValue(MultiplayerOptions.Instance.GetRoundTimeLimitInMinutesForGameMode("Skirmish")*60);
        MultiplayerOptions.OptionType.NumberOfBotsTeam1.SetValue(0);
        MultiplayerOptions.OptionType.NumberOfBotsTeam2.SetValue(0);
        idleStarting=true;idleDeadline=DateTime.UtcNow.AddSeconds(120);
        // StartMission only broadcasts LoadMission. Existing peers also need the new
        // countries and options before constructing the next mission and team UI.
        GameNetwork.BeginBroadcastModuleEvent();GameNetwork.WriteMessage(new MultiplayerOptionsInitial());
        GameNetwork.EndBroadcastModuleEvent(GameNetwork.EventBroadcastFlags.IncludeUnsynchronizedClients);
        GameNetwork.BeginBroadcastModuleEvent();GameNetwork.WriteMessage(new MultiplayerOptionsImmediate());
        GameNetwork.EndBroadcastModuleEvent(GameNetwork.EventBroadcastFlags.IncludeUnsynchronizedClients);
        SubModule.Log("Starting idle Skirmish; unranked free play; pool="+maps.Length);
        manager.StartMission();
    }
    public static bool Abort(){if(claiming!=null)return false;pending=null;owner=null;previous=null;startRequested=false;rankedEndRequested=DateTime.MinValue;rankedEndTimerLogged=false;return true;}
    internal static void SwitchIdle(Transport link,StopCommand command)
    {
        void Finish(string? error){link.CompleteMapControl(command,error);manualId=null;manualPrevious=null;manualStarted=false;SubModule.Log("Idle map command "+command.Id+": "+(error??"loaded "+command.Map));}
        if(claiming!=null)return; // Resolve any in-flight reservation before native actions.
        if(link.State.Active!=null||link.State.Outbox.Count!=0||link.State.Blocked!=null||pending!=null||Recovery.HasPending){Finish("server_busy");return;}
        if(DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()>command.ExpiresAt){Finish("command_expired");return;}
        if(!Policy.SupportsRankedMap(command.Map,MultiplayerGameTypes.GetGameTypeInfo("Skirmish").Scenes,MultiplayerIntermissionVotingManager.Instance.GetUsableMaps("Skirmish"))){Finish("unsupported_map");return;}
        var manager=ServerSideIntermissionManager.Instance;if(manager==null)return;
        if(manualId!=command.Id){manualId=command.Id;manualPrevious=Mission.Current;manualStarted=false;manualEndRequested=DateTime.MinValue;manualDeadline=DateTime.UtcNow.AddSeconds(120);manualRetry=DateTime.MinValue;}
        if(manualStarted&&Mission.Current!=null&&Mission.Current!=manualPrevious&&Mission.Current.CurrentState==Mission.State.Continuing&&Mission.Current.GetMissionBehavior<ArenaBehavior>()?.Initialized==true){link.CurrentMap=MultiplayerOptions.OptionType.Map.GetStrValue();Finish(link.CurrentMap==command.Map?null:"loaded_map_mismatch");return;}
        if(DateTime.UtcNow> manualDeadline){Finish("map_load_timeout");return;}
        if(manualStarted||DateTime.UtcNow<manualRetry)return;
        manualRetry=DateTime.UtcNow.AddSeconds(2);
        if(Mission.Current!=null){
            if(Mission.Current!=manualPrevious){Finish("unexpected_mission");return;}
            if(manualEndRequested==DateTime.MinValue){manualEndRequested=DateTime.UtcNow;manager.EndMission();}
            // Never emit UnloadMission from the application tick: the mission can still
            // queue object replication later in that frame. Let the native lobby perform
            // its complete shutdown in OnUdpNetworkHandlerTick after mission updates.
            // Warmup can overwrite the shared timer; expire it only after the normal
            // post-match wait, without ending the scene or sending packets here.
            else if(DateTime.UtcNow>=manualEndRequested.AddSeconds(MissionLobbyComponent.PostMatchWaitDuration+2)&&!Mission.Current.MissionEnded){
                var lobby=Mission.Current.GetMissionBehavior<MissionLobbyComponent>();
                var timer=Mission.Current.GetMissionBehavior<MultiplayerTimerComponent>();
                if(lobby?.CurrentMultiplayerState!=MissionLobbyComponent.MultiplayerGameState.Ending||timer==null){Finish("native_shutdown_unavailable");return;}
                timer.StartTimerAsServer(0);
                SubModule.Log("Idle map transition: native lobby end timer expired; waiting for network-tick shutdown");
            }
            return;
        }
        if(!manager.ListedServer.IsRegistered||!manager.ListedServer.IsPlaying||idleStarting)return;
        manualStarted=true;try{StartIdle(command.Map);}catch{manualStarted=false;Finish("map_start_failed");}
    }

    public static void Begin(Job job,Transport link)
    {
        pending=job;owner=link;previous=Mission.Current;startRequested=false;
        rankedEndRequested=DateTime.MinValue;rankedEndTimerLogged=false;
        deadline=DateTime.UtcNow.AddSeconds(120);nextAttempt=DateTime.MinValue;
        SubModule.Log("Preparing "+job.MatchId+": "+job.Map+" / "+string.Join(" vs ",job.Cultures));
    }
    public static Job? Adopt(Transport link)
    {
        if(owner!=link||pending==null||!startRequested||Mission.Current==null||Mission.Current==previous)return null;
        var job=pending;pending=null;owner=null;previous=null;startRequested=false;rankedEndRequested=DateTime.MinValue;rankedEndTimerLogged=false;return job;
    }
    static void Fail(string reason)
    {
        if(pending!=null&&owner!=null)owner.Queue("failed",pending,reason:reason);
        pending=null;owner=null;previous=null;startRequested=false;rankedEndRequested=DateTime.MinValue;rankedEndTimerLogged=false;SubModule.Log("Preparation stopped: "+reason);
    }
    public static void Tick()
    {
        var link=SubModule.Link;
        if(link==null||!GameNetwork.IsServer)return;
        link.CurrentMap=Mission.Current==null?null:MultiplayerOptions.OptionType.Map.GetStrValue();
        try
        {
            var manager=ServerSideIntermissionManager.Instance;
            if(manager==null)return;
            if(idleStarting){if(Mission.Current!=null)idleStarting=false;else if(DateTime.UtcNow<idleDeadline)return;else idleStarting=false;}
            if(claiming?.IsCompleted==true)
            {
                Job? job;try{job=claiming.GetAwaiter().GetResult();}finally{claiming=null;}
                if(job!=null){link.State.Active=job;link.Save();Begin(job,link);}
                else if(CanPlayIdle(link)&&!Recovery.HasPending)StartIdle();
            }
            if(link.Control!=null){if(link.Control.Type=="idle-map")SwitchIdle(link,link.Control);return;}
            if(pending==null)
            {
                if(link.State.Active!=null||link.State.Outbox.Count!=0||link.State.Blocked!=null||Recovery.HasPending)return;
                // Once the last result is acknowledged, retire its mission for the next job.
                if(Mission.Current?.GetMissionBehavior<MultiplayerRoundController>()?.IsMatchEnding==true)
                {
                    if(DateTime.UtcNow>=nextAttempt){nextAttempt=DateTime.UtcNow.AddSeconds(2);manager.EndMission();}
                    return;
                }
                if((Mission.Current==null||Mission.Current.GetMissionBehavior<ArenaBehavior>()?.FreePlay==true)&&claiming==null&&DateTime.UtcNow>=nextPoll)
                {nextPoll=DateTime.UtcNow.AddSeconds(5);claiming=link.Claim();}
                return;
            }
            if(DateTime.UtcNow>=deadline){
                SubModule.Log("Preparation timeout detail: startRequested="+startRequested+"; previousMission="+(Mission.Current!=null&&Mission.Current==previous)+"; lobby="+Mission.Current?.GetMissionBehavior<MissionLobbyComponent>()?.CurrentMultiplayerState);
                Fail("map_preparation_timeout");return;
            }
            if(link.State.Blocked!=null)return;
            // StartMission is asynchronous: Mission.Current can appear seconds before
            // ArenaBehavior.AfterStart adopts the roster. Keep it pending throughout loading.
            if(startRequested)return;
            // The bridge owns rotation; running native automated rotation concurrently races it.
            if(MultiplayerIntermissionVotingManager.Instance.IsAutomatedBattleSwitchingEnabled)
            {Fail("disable_native_automated_battle_switching");return;}
            if(DateTime.UtcNow<nextAttempt)return;
            nextAttempt=DateTime.UtcNow.AddSeconds(2);
            // UsableMaps is the optional voting pool, not the installed Skirmish catalog.
            // Validate before retiring the previous mission, even with voting disabled.
            if(!Policy.Valid(pending,null)){Fail("invalid_match_job");return;}
            if(!Policy.SupportsRankedMap(pending.Map,MultiplayerGameTypes.GetGameTypeInfo("Skirmish").Scenes,MultiplayerIntermissionVotingManager.Instance.GetUsableMaps("Skirmish")))
            {Fail("unsupported_skirmish_map");return;}
            if(Mission.Current!=null)
            {
                if(Mission.Current!=previous){Fail("unexpected_mission_during_preparation");return;}
                if(rankedEndRequested==DateTime.MinValue){
                    rankedEndRequested=DateTime.UtcNow;
                    SubModule.Log("Ranked preparation: requesting previous mission shutdown; lobby="+Mission.Current.GetMissionBehavior<MissionLobbyComponent>()?.CurrentMultiplayerState);
                    manager.EndMission();
                }else if(DateTime.UtcNow>=rankedEndRequested.AddSeconds(MissionLobbyComponent.PostMatchWaitDuration+2)&&!Mission.Current.MissionEnded){
                    // As with manual map switches, round transitions may replace
                    // the lobby's shared end timer. Only expire that timer; let
                    // the native network tick send unload and retire the scene.
                    var lobby=Mission.Current.GetMissionBehavior<MissionLobbyComponent>();
                    var timer=Mission.Current.GetMissionBehavior<MultiplayerTimerComponent>();
                    if(lobby?.CurrentMultiplayerState!=MissionLobbyComponent.MultiplayerGameState.Ending||timer==null){Fail("native_shutdown_unavailable");return;}
                    timer.StartTimerAsServer(0);
                    if(!rankedEndTimerLogged){SubModule.Log("Ranked preparation: native lobby end timer expired; waiting for network-tick shutdown");rankedEndTimerLogged=true;}
                }
                return;
            }
            var votes=MultiplayerIntermissionVotingManager.Instance;
            votes.IsMapVoteEnabled=false;votes.IsCultureVoteEnabled=false;
            votes.IsDisableMapVoteOverride=true;votes.IsDisableCultureVoteOverride=true;
            MultiplayerOptions.OptionType.GameType.SetValue("Skirmish");
            MultiplayerOptions.OptionType.Map.SetValue(pending.Map);
            MultiplayerOptions.OptionType.CultureTeam1.SetValue(pending.Cultures[0]);
            MultiplayerOptions.OptionType.CultureTeam2.SetValue(pending.Cultures[1]);
            MultiplayerOptions.OptionType.RoundTotal.SetValue(5);
            // Restore the native Skirmish duration, not the generic 120s test default.
            MultiplayerOptions.OptionType.RoundTimeLimit.SetValue(MultiplayerOptions.Instance.GetRoundTimeLimitInMinutesForGameMode("Skirmish") * 60);
            MultiplayerOptions.OptionType.WarmupTimeLimitInSeconds.SetValue(link.Config.ArrivalTimeoutSeconds);
            MultiplayerOptions.OptionType.MinNumberOfPlayersForMatchStart.SetValue(13);
            MultiplayerOptions.OptionType.NumberOfBotsTeam1.SetValue(0);
            MultiplayerOptions.OptionType.NumberOfBotsTeam2.SetValue(0);
            GameNetwork.BeginBroadcastModuleEvent();GameNetwork.WriteMessage(new MultiplayerOptionsInitial());
            GameNetwork.EndBroadcastModuleEvent(GameNetwork.EventBroadcastFlags.IncludeUnsynchronizedClients);
            GameNetwork.BeginBroadcastModuleEvent();GameNetwork.WriteMessage(new MultiplayerOptionsImmediate());
            GameNetwork.EndBroadcastModuleEvent(GameNetwork.EventBroadcastFlags.IncludeUnsynchronizedClients);
            SubModule.Log("Starting prepared mission: "+pending.Map+" / "+string.Join(" vs ",pending.Cultures));
            startRequested=true; // Set before calling native code, including synchronous callbacks.
            manager.StartMission();
        }
        catch(Exception e)
        {
            if(pending!=null)Fail("preparation_exception_"+e.GetType().Name);
            else SubModule.Log("Intermission poll: "+e.GetType().Name);
        }
    }
}
