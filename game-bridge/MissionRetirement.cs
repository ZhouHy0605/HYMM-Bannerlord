using System.Diagnostics;
using TaleWorlds.MountAndBlade;
using TaleWorlds.MountAndBlade.ListedServer;

namespace ArenaBridge;

// One retirement per native scene, shared by ranked preparation, manual switches
// and administrative cancellation. All calls stay on the application thread.
internal static class MissionRetirement
{
    internal static Func<double> Now=()=>Stopwatch.GetTimestamp()/(double)Stopwatch.Frequency;
    static Mission? retiring;
    static double requested,nextCheck;
    static bool endRequested,timerExpired;
    static string context="";
    internal static string? Error {get;private set;}
    internal static bool IsRetiring(Mission mission)=>retiring==mission;

    internal static void Request(Mission mission,string reason)
    {
        if(Mission.Current!=mission)return;
        if(retiring!=mission){
            retiring=mission;context=reason;requested=Now();nextCheck=0;
            endRequested=false;timerExpired=false;Error=null;
            // Native ChangeTeamServer can kill a living agent. Stop HYMM scoring
            // and roster correction BEFORE triggering any native team callbacks.
            mission.GetMissionBehavior<ArenaBehavior>()?.BeginRetirement();
            SubModule.Log("Mission retirement requested: "+reason);
        }
        Tick();
    }

    internal static void Tick()
    {
        if(retiring==null)return;
        if(Mission.Current!=retiring){retiring=null;Error=null;return;}
        if(Now()<nextCheck)return;
        nextCheck=Now()+2;
        var mission=retiring;
        if(mission.MissionEnded||mission.CurrentState!=Mission.State.Continuing)return;
        try{
            var peers=GameNetwork.NetworkPeers.Where(p=>!p.IsServerPeer&&p.IsSynchronized&&
                p.GetComponent<MissionPeer>() is { } player&&player.Team!=mission.SpectatorTeam).ToArray();
            var selector=mission.GetMissionBehavior<MultiplayerTeamSelectComponent>();
            if(peers.Length>0&&(selector==null||mission.SpectatorTeam==null)){SetError("spectator_transition_unavailable");return;}
            foreach(var peer in peers)selector!.ChangeTeamServer(peer,mission.SpectatorTeam);
            if(peers.Length>0)SubModule.Log("Mission retirement: moved to spectator="+peers.Length+"; reason="+context);
            if(!endRequested){
                var manager=ServerSideIntermissionManager.Instance;
                if(manager==null||!manager.ListedServer.IsRegistered||!manager.ListedServer.IsPlaying){SetError("native_shutdown_unavailable");return;}
                requested=Now();endRequested=true;Error=null;
                manager.EndMission();
                return;
            }
            if(Now()-requested<MissionLobbyComponent.PostMatchWaitDuration+2)return;
            var lobby=mission.GetMissionBehavior<MissionLobbyComponent>();
            var timer=mission.GetMissionBehavior<MultiplayerTimerComponent>();
            if(lobby?.CurrentMultiplayerState!=MissionLobbyComponent.MultiplayerGameState.Ending||timer==null){SetError("native_shutdown_unavailable");return;}
            Error=null;
            // Round transitions share this timer. Do not unload or desynchronize
            // here: the native network tick must perform the ordered shutdown.
            timer.StartTimerAsServer(0);
            if(!timerExpired){
                timerExpired=true;
                SubModule.Log("Mission retirement: expired native ending timer; waiting for network-tick shutdown; reason="+context);
            }
        }catch(Exception e){SetError("retirement_exception_"+e.GetType().Name);}
    }

    static void SetError(string error){if(Error!=error)SubModule.Log("Mission retirement: "+error+"; reason="+context);Error=error;}
}
