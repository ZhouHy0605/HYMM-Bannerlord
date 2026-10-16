using TaleWorlds.Core;
using TaleWorlds.MountAndBlade;
using NetworkMessages.FromServer;
using System.Reflection;

namespace ArenaBridge;

// Run only in Ended, before the native controller can begin another round.
// There is no EndMission/StartMission, lobby transition, warmup or player rejoin.
internal static class NativeHalftime
{
    // These native totals have internal setters in 1.4.8. Resolve them up front;
    // use only to restore a pre-halftime snapshot if cleanup hooks change a value.
    static readonly Dictionary<string,PropertyInfo> Totals=new[]{"KillCount","DeathCount","AssistCount","Score"}
        .ToDictionary(name=>name,name=>typeof(MissionPeer).GetProperty(name) is { } p&&p.GetSetMethod(true)!=null?p:throw new Exception("unsupported_personal_score_api"));
    static void Restore(MissionPeer peer,string name,int current,int saved){if(current!=saved)Totals[name].SetValue(peer,saved);}
    public static void Hold(Mission mission)
    {
        var rounds=mission.GetMissionBehavior<MultiplayerRoundController>();
        var timer=mission.GetMissionBehavior<MultiplayerTimerComponent>();
        if(rounds==null||timer==null||rounds.IsMatchEnding||rounds.CurrentRoundState!=MultiplayerRoundState.Ended)throw new Exception("invalid_halftime_state");
        // Hold immediately on the game thread, but do not exchange sides, reset
        // scores or remove agents until the first-half result is safely stored.
        timer.StartTimerAsServer(86400);
    }
    public static void Reset(Mission mission,Action exchangeRoster)
    {
        var rounds=mission.GetMissionBehavior<MultiplayerRoundController>();
        var board=mission.GetMissionBehavior<MissionScoreboardComponent>();
        var timer=mission.GetMissionBehavior<MultiplayerTimerComponent>();
        var mode=mission.GetMissionBehavior<MissionMultiplayerFlagDomination>();
        if(rounds==null||board==null||timer==null||mode==null||rounds.IsMatchEnding||rounds.CurrentRoundState!=MultiplayerRoundState.Ended)throw new Exception("invalid_halftime_state");
        _=Totals.Count; // Validate score-restoration compatibility before any native mutation.
        // Keep the native round controller in Ended until both ordered HTTP events
        // are acknowledged. A blocked bridge must never silently start leg two.
        Hold(mission);
        var totals=GameNetwork.NetworkPeers.Where(p=>!p.IsServerPeer).Select(p=>p.GetComponent<MissionPeer>()).OfType<MissionPeer>()
            .Select(p=>(peer:p,kills:p.KillCount,deaths:p.DeathCount,assists:p.AssistCount,score:p.Score)).ToArray();
        try
        {
            // Native per-round cleanup deletes agents and detaches their peers without
            // a killing blow. Do this BEFORE ChangeTeamServer, whose live-agent path
            // calls Die(TeamSwitch) and can add a death, suicide penalty or assist.
            // This is the standard round reset, not EndMission or loading a new map.
            mission.ResetMission();
            if(totals.Any(p=>p.peer.ControlledAgent!=null))throw new Exception("halftime_agents_not_cleared");
            exchangeRoster();
        }
        finally
        {
            // Keep cumulative personal scores across halves, including in-memory
            // client scoreboards. Snapshot every peer so no bystander gets a phantom assist.
            foreach(var p in totals)
            {
                Restore(p.peer,"KillCount",p.peer.KillCount,p.kills);Restore(p.peer,"DeathCount",p.peer.DeathCount,p.deaths);
                Restore(p.peer,"AssistCount",p.peer.AssistCount,p.assists);Restore(p.peer,"Score",p.peer.Score,p.score);
                board.PlayerPropertiesChanged(p.peer.GetNetworkPeer());
                GameNetwork.BeginBroadcastModuleEvent();GameNetwork.WriteMessage(new KillDeathCountChange(p.peer.GetNetworkPeer(),null,p.kills,p.assists,p.deaths,p.score));
                GameNetwork.EndBroadcastModuleEvent(GameNetwork.EventBroadcastFlags.IncludeUnsynchronizedClients);
            }
        }
        board.ChangeTeamScore(mission.AttackerTeam,-board.GetRoundScore(BattleSideEnum.Attacker));
        board.ChangeTeamScore(mission.DefenderTeam,-board.GetRoundScore(BattleSideEnum.Defender));
        rounds.RoundCount=0;rounds.RoundWinner=BattleSideEnum.None;rounds.RoundEndReason=RoundEndReason.Invalid;
        MultiplayerOptions.OptionType.RoundTotal.SetValue(5);
        // Native ChangeTeamServer selects the opposite culture and spawn side, but
        // also sets gold to zero. Start both sides equally for the new half.
        foreach(var peer in GameNetwork.NetworkPeers)
        {
            var player=peer.GetComponent<MissionPeer>();
            if(!peer.IsServerPeer&&peer.IsSynchronized&&player?.Team!=null&&player.Team.Side!=BattleSideEnum.None)
                mode.ChangeCurrentGoldForPeer(player,MissionMultiplayerFlagDomination.DefaultGoldAmountForTroopSelectionForSkirmish);
        }
        GameNetwork.BeginBroadcastModuleEvent();GameNetwork.WriteMessage(new MultiplayerOptionsInitial());
        GameNetwork.EndBroadcastModuleEvent(GameNetwork.EventBroadcastFlags.IncludeUnsynchronizedClients);
        Announce("第一轮结束，双方已交换国家与出生点；个人战绩保留，第二轮回合比分 0 : 0，正在确认开赛。");
    }
    public static void Resume(Mission mission)
    {
        var rounds=mission.GetMissionBehavior<MultiplayerRoundController>();
        var timer=mission.GetMissionBehavior<MultiplayerTimerComponent>();
        if(rounds==null||timer==null||rounds.IsMatchEnding||rounds.CurrentRoundState!=MultiplayerRoundState.Ended||rounds.RoundCount!=0)throw new Exception("invalid_halftime_resume");
        timer.StartTimerAsServer(5);
        Announce("第二轮将在 5 秒后进入选兵准备，双方重新抢三。");
    }
    static void Announce(string text)
    {
        GameNetwork.BeginBroadcastModuleEvent();GameNetwork.WriteMessage(new ServerMessage("[HYMM] "+text));
        GameNetwork.EndBroadcastModuleEvent(GameNetwork.EventBroadcastFlags.IncludeUnsynchronizedClients);
    }
}
