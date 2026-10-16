using System.Reflection;
using System.Text.Json;
using TaleWorlds.MountAndBlade;
using TaleWorlds.Core;

namespace ArenaBridge;
public sealed class SubModule : MBSubModuleBase
{
    internal static Transport? Link;
    static BufferedDiagnosticLog? diagnostics;
    protected override void OnSubModuleLoad()
    {
        base.OnSubModuleLoad();
        try
        {
            string dir=Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location)!;
            string configPath=Environment.GetEnvironmentVariable("ARENA_BRIDGE_CONFIG")??Path.Combine(dir,"bridge.json");
            diagnostics=BufferedDiagnosticLog.ToFile(Path.Combine(Path.GetDirectoryName(configPath)!,"bridge.log"));
            var config=JsonSerializer.Deserialize<Config>(File.ReadAllText(configPath),Transport.Json)!;
            Link=new Transport(config,Path.Combine(Path.GetDirectoryName(configPath)!,"bridge-state.json"),Log);
            Log("Loaded v0.4.10; custom ranked map registration; native scoreboard ADR; native Skirmish round duration; disconnects do not interrupt play; arrival timeout="+config.ArrivalTimeoutSeconds+"s; asynchronous map preparation, in-place halftime, combat v2; explicit identity mappings="+config.GameIdToSteamId.Count);
        }
        catch(Exception e){Log("DISABLED: "+e.Message);}
    }
    protected override void OnApplicationTick(float dt){base.OnApplicationTick(dt);Recovery.Tick();Preparation.Tick();Link?.Tick();Operations.Tick();MissionRetirement.Tick();}
    public override void OnBeforeMissionBehaviorInitialize(Mission mission)
    {
        base.OnBeforeMissionBehaviorInitialize(mission);
        if(!GameNetwork.IsServer||MultiplayerOptions.OptionType.GameType.GetStrValue()!="Skirmish")return;
        // Replace before other behaviors cache the selector. The original's removal unregisters
        // its TeamChange handler; this subclass keeps native spawning and team notifications.
        var original=mission.GetMissionBehavior<MultiplayerTeamSelectComponent>();
        if(original!=null)mission.RemoveMissionBehavior(original);
        var selector=new RosterTeamSelectComponent();
        mission.AddMissionBehavior(selector);
        selector.OnAfterMissionCreated(); // The mission creation callback has already run.
        if(Link!=null){mission.AddMissionBehavior(new ArenaBehavior(Link));mission.AddMissionBehavior(new ServerNotices(Link.Config));}
        if(Link?.Config.EnableArmory==true)mission.AddMissionBehavior(new Armory(Link));
        Log("Team selection installed; idle free play, ranked roster enforcement");
    }
    protected override void OnSubModuleUnloaded()
    {
        diagnostics?.Dispose();diagnostics=null;
        base.OnSubModuleUnloaded();
    }
    internal static void Log(string s)=>diagnostics?.Write(s);

}
public sealed class ArenaBehavior : MissionBehavior
{
    readonly Transport link;
    Job? job;
    MultiplayerRoundController? rounds;
    string? startEvent;
    bool live,terminal,correcting;
    DateTime arrivalDeadline;
    readonly HashSet<string> seen=new();
    readonly HashSet<NetworkCommunicator> admitted=new();
    bool switchingSides;
    DateTime switchDeadline;
    bool roundEndingSubscribed;
    CombatLedger? ledger;
    readonly Dictionary<MissionPeer,string> scorePeers=new();
    readonly Dictionary<string,float> damage=new();
    readonly Dictionary<string,float> horseDamage=new();
    readonly CombatSpawns spawns=new();
    bool recording;
    readonly KillStreaks streaks=new();
    internal bool Initialized {get;private set;}
    public ArenaBehavior(Transport transport){link=transport;}
    public override MissionBehaviorType BehaviorType=>MissionBehaviorType.Other;
    public override void AfterStart()
    {
        if(MultiplayerOptions.OptionType.GameType.GetStrValue()!="Skirmish"){terminal=true;return;}
        var prepared=Preparation.Adopt(link);
        MultiplayerOptions.OptionType.MinNumberOfPlayersForMatchStart.SetValue(prepared!=null?13:2);
        MultiplayerOptions.OptionType.WarmupTimeLimitInSeconds.SetValue(prepared!=null?link.Config.ArrivalTimeoutSeconds:Preparation.IdleWarmupSeconds);
        MultiplayerOptions.OptionType.RoundTotal.SetValue(5);
        MultiplayerOptions.OptionType.NumberOfBotsTeam1.SetValue(0);
        MultiplayerOptions.OptionType.NumberOfBotsTeam2.SetValue(0);
        // Uneven online counts must never move another player off the fixed roster.
        MultiplayerOptions.OptionType.AutoTeamBalanceThreshold.SetValue(0);
        rounds=Mission.GetMissionBehavior<MultiplayerRoundController>();
        if(rounds!=null){rounds.OnRoundStarted+=RoundStarted;rounds.OnRoundEnding+=ResetStreaks;}
        MissionPeer.OnTeamChanged+=TeamChanged;
        if(prepared!=null){job=prepared;arrivalDeadline=DateTime.UtcNow.AddSeconds(link.Config.ArrivalTimeoutSeconds);if(!Policy.Valid(job,Map)||!CulturesMatch()||rounds==null||rounds.RoundCount!=0)Fail("prepared_mission_mismatch");else SubModule.Log($"Adopted {job.MatchId} leg={job.Leg}; cultures(attacker/defender)={string.Join("/",job.Cultures)}");}
        Initialized=true;
    }
    string Map=>MultiplayerOptions.OptionType.Map.GetStrValue();
    string? Identity(NetworkCommunicator peer)
    {
        string gameId=peer.VirtualPlayer.Id.ToString();
        if(seen.Add(gameId))SubModule.Log("Authenticated game ID: "+gameId);
        return NativeIdentity.Resolve(peer.VirtualPlayer.Id,link.Config.GameIdToSteamId);
    }
    public override void OnMissionTick(float dt)
    {
        try
        {
            Assign(); // Free play skips this; ranked and blocked missions enforce the roster.
            if(link.Control!=null)return;
            if(terminal||link.State.Blocked!=null)return;
            if(job==null)
            {
                // The application-level preparation manager owns claims across idle mission rotation.
                foreach(var p in GameNetwork.NetworkPeers)if(!p.IsServerPeer&&p.IsSynchronized)Identity(p);
                return;
            }
            if(Map!=job.Map||!CulturesMatch()){Fail("map_or_culture_changed");return;}
            Assign();
            if(recording){ObserveSpawns();SampleStats();}
            bool complete=RosterReady();
            if(switchingSides)
            {
                if(DateTime.UtcNow>switchDeadline){Fail("halftime_ack_timeout");return;}
                startEvent??=link.Queue("started",job);
                if(!link.Pending(startEvent))
                {
                    NativeHalftime.Resume(Mission);switchingSides=false;live=true;
                    SubModule.Log($"Second leg resumes in same mission: {job.MatchId}; A=defender, B=attacker; score=0:0");
                }
                return;
            }
            if(!live)
            {
                if(rounds==null||rounds.RoundCount!=0){Fail("round_started_before_authorization");return;}
                if(!complete&&DateTime.UtcNow>=arrivalDeadline){Fail("arrival_timeout");return;}
                if(startEvent==null && complete)startEvent=link.Queue("started",job);
                if(startEvent!=null && !link.Pending(startEvent) && complete)
                {
                    // Only the initial start requires all 12. Native checks this again after halftime.
                    MultiplayerOptions.OptionType.MinNumberOfPlayersForMatchStart.SetValue(0);
                    // Subscribe after all native AfterStart callbacks: the native scoreboard
                    // has already registered its OnRoundEnding score update ahead of us.
                    rounds!.OnRoundEnding+=RoundEnding;rounds.OnPostRoundEnded+=RoundEnded;roundEndingSubscribed=true;
                    live=true;var warmup=Mission.GetMissionBehavior<MultiplayerWarmupComponent>();
                    if(warmup?.IsInWarmup==true)warmup.EndWarmupProgress();
                    SubModule.Log("Roster verified; match live "+job.MatchId);
                }
            }
        }
        catch(Exception e){SubModule.Log("Mission check: "+e.GetType().Name);if(job!=null)Fail("bridge_exception");}
    }
    bool CulturesMatch()=>job!=null&&MultiplayerOptions.OptionType.CultureTeam1.GetStrValue()==job.Cultures[0]&&MultiplayerOptions.OptionType.CultureTeam2.GetStrValue()==job.Cultures[1];
    void Assign()
    {
        if(!Preparation.CanSelectTeam(Mission))return;
        if(FreePlay)return;
        if(correcting)return;
        var select=Mission.GetMissionBehavior<MultiplayerTeamSelectComponent>();if(select==null)return;
        correcting=true;
        try
        {
            admitted.RemoveWhere(peer=>!GameNetwork.NetworkPeers.Contains(peer));
            foreach(var peer in GameNetwork.NetworkPeers.ToArray())
            {
                var mp=peer.GetComponent<MissionPeer>();if(peer.IsServerPeer||!peer.IsSynchronized||mp==null)continue;
                var id=Identity(peer);
                if(mp.Team==null&&!admitted.Contains(peer))continue; // First leg still requires explicit auto-assignment.
                var target=Target(Policy.SelectionSide(SelectionJob,id,admitted.Contains(peer)));
                if(target!=null && mp.Team!=target)select.ChangeTeamServer(peer,target);
            }
        }
        finally{correcting=false;}
    }
    Job? SelectionJob=>!terminal&&link.State.Blocked==null&&link.Control==null?job:null;
    internal bool FreePlay=>job==null&&!terminal&&Preparation.CanPlayIdle(link);
    Team Target(int side)=>side switch{0=>Mission.AttackerTeam,1=>Mission.DefenderTeam,_=>Mission.SpectatorTeam};
    internal void SelectTeam(NetworkCommunicator peer,bool autoAssign,bool spectator)
    {
        if(!Preparation.CanSelectTeam(Mission))return;
        var mp=peer.GetComponent<MissionPeer>();
        if(peer.IsServerPeer||!peer.IsSynchronized||mp==null)return;
        var id=Identity(peer);
        int side=Policy.SelectionSide(SelectionJob,id,admitted.Contains(peer),autoAssign,spectator);
        if(side>=0)admitted.Add(peer);else admitted.Remove(peer);
        var target=Target(side);
        var selector=Mission.GetMissionBehavior<MultiplayerTeamSelectComponent>();
        if(selector==null||target==null)return;
        correcting=true;
        try{if(mp.Team!=target)selector.ChangeTeamServer(peer,target);}
        finally{correcting=false;}
        SubModule.Log("Team request: "+(autoAssign?"auto":"manual")+"; assigned="+(side<0?"spectator":side==0?"attacker":"defender"));
    }
    bool RosterReady()
    {
        if(job==null)return false;
        var ids=new HashSet<string>();
        foreach(var peer in GameNetwork.NetworkPeers)
        {
            var mp=peer.GetComponent<MissionPeer>();if(peer.IsServerPeer||!peer.IsSynchronized||mp==null)continue;
            var id=Identity(peer);int team=Policy.Side(job,id);
            if(team>=0 && mp.Team==(team==0?Mission.AttackerTeam:Mission.DefenderTeam) && !ids.Add(id!))return false;
        }
        return ids.Count==12;
    }
    void TeamChanged(NetworkCommunicator peer,Team oldTeam,Team newTeam)
    {
        var agent=peer.GetComponent<MissionPeer>()?.ControlledAgent;if(agent!=null)streaks.Forget(agent);
        if(terminal||MissionRetirement.IsRetiring(Mission))return;
        if(FreePlay)return;
        if(correcting||peer.IsServerPeer)return;
        // A mid-round side switch invalidates the match rather than silently scoring compromised play.
        int team=Policy.SelectionSide(SelectionJob,Identity(peer),admitted.Contains(peer));var expected=Target(team);
        if(team>=0 && live && rounds?.IsRoundInProgress==true && expected!=newTeam)Fail("unauthorized_team_change");
        Assign();
    }
    void RoundStarted()
    {
        ResetStreaks();
        if(job==null||terminal)return;
        Assign();if(!live){Fail("round_started_before_authorization");return;}
        ledger??=new CombatLedger(job.Teams.SelectMany(t=>t));
        ledger.BeginRound();damage.Clear();horseDamage.Clear();spawns.BeginRound();
        foreach(var id in ledger.Players.Keys){damage[id]=0;horseDamage[id]=0;}
        SampleStats(true);recording=true;
        ObserveSpawns();
    }
    void SampleStats(bool baselineOnly=false)
    {
        if(ledger==null)return;
        // Retain references for explicit quits too, not just native timeout peers.
        foreach(var peer in GameNetwork.NetworkPeersIncludingDisconnectedPeers){
            if(peer.IsServerPeer)continue;
            var id=Identity(peer);var mp=peer.GetComponent<MissionPeer>();
            if(id!=null&&mp!=null&&ledger.Players.ContainsKey(id))scorePeers[mp]=id;
        }
        foreach(var entry in scorePeers){var mp=entry.Key;ledger.Observe(entry.Value,mp,mp.KillCount,mp.DeathCount,mp.AssistCount,baselineOnly,mp.Score);}
    }
    void RoundEnding()
    {
        if(job==null||terminal||!live||rounds==null)return;
        var board=Mission.GetMissionBehavior<MissionScoreboardComponent>();
        if(board==null){Fail("missing_scoreboard");return;}
        int a=board.GetRoundScore(BattleSideEnum.Attacker),b=board.GetRoundScore(BattleSideEnum.Defender);
        try{
            bool firstHalf=job.Format=="two-leg-v1"&&job.Leg==0;
            int limit=Policy.RoundLimit(rounds.RoundCount,a,b,firstHalf&&Policy.FinalScore(a,b));
            MultiplayerOptions.OptionType.RoundTotal.SetValue(limit);
            GameNetwork.BeginBroadcastModuleEvent();GameNetwork.WriteMessage(new NetworkMessages.FromServer.MultiplayerOptionsInitial());
            GameNetwork.EndBroadcastModuleEvent(GameNetwork.EventBroadcastFlags.IncludeUnsynchronizedClients);
            SubModule.Log($"Round ended {job.MatchId} leg={job.Leg}; played={rounds.RoundCount}; winner={rounds.RoundWinner}; physicalScore={a}:{b}; nativeLimit={limit}");
        }catch(Exception e){Fail(e.Message is "round_safety_limit" or "invalid_round_score"?e.Message:"round_limit_update_failed");}
    }
    void ObserveSpawn(Agent agent)
    {
        if(!recording||terminal||job==null||agent==null||!agent.IsHuman||!agent.IsActive()||agent.MissionPeer==null)return;
        var id=Identity(agent.MissionPeer.GetNetworkPeer());if(id==null||ledger==null||!ledger.Players.TryGetValue(id,out var p))return;
        spawns.Observe(agent,p,agent.MountAgent!=null,HasBow(agent));
    }
    static bool HasBow(Agent agent)
    {
        for(var slot=EquipmentIndex.Weapon0;slot<EquipmentIndex.NumAllWeaponSlots;slot++){
            var weapon=agent.Equipment[slot].Item?.PrimaryWeapon;
            if(weapon?.IsBow==true||weapon?.IsCrossBow==true)return true;
        }
        return false;
    }
    void ObserveSpawns(){foreach(var peer in GameNetwork.NetworkPeers){var agent=peer.GetComponent<MissionPeer>()?.ControlledAgent;if(agent!=null)ObserveSpawn(agent);}}
    public override void OnAgentControllerSetToPlayer(Agent agent){base.OnAgentControllerSetToPlayer(agent);ObserveSpawn(agent);}
    void ResetStreaks()=>streaks.Reset();
    public override void OnAgentRemoved(Agent affectedAgent,Agent affectorAgent,AgentState agentState,KillingBlow killingBlow)
    {
        base.OnAgentRemoved(affectedAgent,affectorAgent,agentState,killingBlow);
        if(affectedAgent==null||!affectedAgent.IsHuman||affectedAgent.MissionPeer==null)return;
        var attacker=affectorAgent?.IsMount==true?affectorAgent.RiderAgent:affectorAgent;
        bool eligible=agentState==AgentState.Killed&&!terminal&&!switchingSides&&!correcting&&
            Preparation.CanSelectTeam(Mission)&&rounds?.IsRoundInProgress==true&&(FreePlay||live)&&
            attacker?.IsHuman==true&&attacker.IsActive()&&attacker.MissionPeer!=null&&
            attacker.Team!=null&&affectedAgent.Team!=null&&attacker.Team.Side!=BattleSideEnum.None&&
            affectedAgent.Team.Side!=BattleSideEnum.None&&attacker.Team!=affectedAgent.Team;
        int count=streaks.Removed(affectedAgent,attacker,eligible,ServerNotices.Now);
        if(count>0)ServerNotices.BroadcastStreak(attacker?.MissionPeer?.Name??"玩家",count);
    }
    void RoundEnded()
    {
        if(job==null||terminal||!live)return;
        if(recording){
            ObserveSpawns();SampleStats();recording=false;
            foreach(var p in ledger!.Players.Values){p.Damage+=(int)Math.Round(damage[p.Id]);p.HorseDamage+=(int)Math.Round(horseDamage[p.Id]);}
            ledger.EndRound();
        }
        if(rounds==null)return;
        var board=Mission.GetMissionBehavior<MissionScoreboardComponent>();
        if(board==null){Fail("missing_scoreboard");return;}
        int a=board.GetRoundScore(BattleSideEnum.Attacker),b=board.GetRoundScore(BattleSideEnum.Defender);
        bool halftime=job.Format=="two-leg-v1"&&job.Leg==0&&Policy.FinalScore(a,b);
        if(!halftime&&!rounds.IsMatchEnding)return;
        SubModule.Log($"Leg ending {job.MatchId} leg={job.Leg}; played={rounds.RoundCount}; physicalScore={a}:{b}; rosterReady={RosterReady()}");
        if(!Policy.FinalScore(a,b)){Fail("nonstandard_end_score");return;}
        var report=ledger!=null&&ledger.Players.Count==12&&ledger.Players.Values.All(p=>p.Rounds==rounds.RoundCount&&p.Deaths<=p.Spawns)?new CombatReport{Version=2,DrawRounds=rounds.RoundCount-a-b,Players=ledger.Players.Values.ToArray()}:null;
        if(report==null){Fail("combat_v2_required");return;}
        if(halftime)
        {
            live=false;switchingSides=true;switchDeadline=DateTime.UtcNow.AddSeconds(120);startEvent=null;
            try
            {
                job=link.BeginSecondLeg(job,Policy.OriginalScore(job,a,b),report);
                NativeHalftime.Reset(Mission,Assign);
                ledger=new CombatLedger(job.Teams.SelectMany(t=>t));damage.Clear();horseDamage.Clear();spawns.BeginRound();
                SubModule.Log($"In-place switch {job.MatchId}; first score={a}:{b}; 12-player roster retained; new leg=1");
            }
            catch(Exception e){SubModule.Log("Halftime failed: "+e.GetType().Name);Fail("halftime_switch_failed");}
            return;
        }
        link.Queue("finished",job,Policy.OriginalScore(job,a,b),combat:report);terminal=true;
    }
    public override void OnScoreHit(Agent affectedAgent,Agent affectorAgent,WeaponComponentData attackerWeapon,bool isBlocked,bool isSiegeEngineHit,in Blow blow,in AttackCollisionData collisionData,float damagedHp,float hitDistance,float shotDifficulty)
    {
        if(!recording||terminal||job==null||rounds?.IsRoundInProgress!=true||isBlocked||!float.IsFinite(damagedHp)||damagedHp<=0)return;
        var victimAgent=affectedAgent?.IsMount==true?affectedAgent.RiderAgent:affectedAgent;
        var attackerAgent=affectorAgent?.IsMount==true?affectorAgent.RiderAgent:affectorAgent;
        var victim=victimAgent?.MissionPeer;var attacker=attackerAgent?.MissionPeer;
        if(victim==null||attacker==null||victimAgent!.Team==attackerAgent!.Team)return;
        ObserveSpawn(attackerAgent);ObserveSpawn(victimAgent);
        var id=Identity(attacker.GetNetworkPeer());var other=Identity(victim.GetNetworkPeer());
        if(id==null||Policy.Team(job,id)<0||Policy.Team(job,other)<0||!damage.ContainsKey(id))return;
        if(affectedAgent!.IsMount)horseDamage[id]+=damagedHp;else damage[id]+=damagedHp;
    }
    internal void BeginRetirement(){terminal=true;recording=false;streaks.Reset();}
    public bool StopByAdmin(string matchId){if(job!=null&&job.MatchId!=matchId)return false;BeginRetirement();return true;}
    void Fail(string reason)
    {
        if(terminal||job==null)return;
        link.Queue("failed",job,reason:reason);terminal=true;SubModule.Log("Paused for review: "+reason);
    }
    public override void OnRemoveBehavior()
    {
        if(rounds!=null){rounds.OnRoundStarted-=RoundStarted;rounds.OnRoundEnding-=ResetStreaks;rounds.OnPostRoundEnded-=RoundEnded;}
        if(roundEndingSubscribed&&rounds!=null)rounds.OnRoundEnding-=RoundEnding;
        MissionPeer.OnTeamChanged-=TeamChanged;
        Fail("mission_removed_before_result");
        base.OnRemoveBehavior();
    }
}
internal static class Recovery
{
    static readonly List<(Task<Job?> task,Transport link)> pending=new();
    public static bool HasPending=>pending.Count>0;
    public static void Add(Task<Job?> task,Transport link)=>pending.Add((task,link));
    public static void Tick()
    {
        foreach(var p in pending.ToArray())if(p.task.IsCompleted)
        {
            try{var j=p.task.GetAwaiter().GetResult();if(j!=null){p.link.State.Active=j;p.link.Queue("failed",j,reason:"mission_removed_during_claim");}}catch(Exception e){SubModule.Log("Late claim: "+e.GetType().Name);}
            pending.Remove(p);
        }
    }
}
