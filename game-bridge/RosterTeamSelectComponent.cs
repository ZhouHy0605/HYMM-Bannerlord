using NetworkMessages.FromClient;
using TaleWorlds.MountAndBlade;
using TaleWorlds.MountAndBlade.Network.Messages;

namespace ArenaBridge;

// Intercept before native auto balancing or a manually requested side can change the peer.
public sealed class RosterTeamSelectComponent : MultiplayerTeamSelectComponent
{
    protected override void AddRemoveMessageHandlers(GameNetwork.NetworkMessageHandlerRegistererContainer registerer)
    {
        if(GameNetwork.IsServer)registerer.RegisterBaseHandler<TeamChange>(HandleRosterRequest);
    }

    bool HandleRosterRequest(NetworkCommunicator peer,GameNetworkMessage message)
    {
        if(!Preparation.CanSelectTeam(Mission))return true;
        var request=(TeamChange)message;
        bool spectator=!request.AutoAssign&&Mission.SpectatorTeam!=null&&request.TeamIndex==Mission.SpectatorTeam.TeamIndex;
        var arena=Mission.GetMissionBehavior<ArenaBehavior>();
        if(arena?.FreePlay==true&&!peer.IsServerPeer&&peer.IsSynchronized&&peer.GetComponent<MissionPeer>()!=null){
            if(request.AutoAssign)AutoAssignTeam(peer);
            else {
                var team=request.TeamIndex==Mission.AttackerTeam?.TeamIndex?Mission.AttackerTeam:
                    request.TeamIndex==Mission.DefenderTeam?.TeamIndex?Mission.DefenderTeam:Mission.SpectatorTeam;
                if(team!=null)ChangeTeamServer(peer,team);
            }
        }
        else if(arena!=null)arena.SelectTeam(peer,request.AutoAssign,spectator);
        else if(!peer.IsServerPeer&&peer.IsSynchronized&&peer.GetComponent<MissionPeer>()!=null&&Mission.SpectatorTeam!=null)
            ChangeTeamServer(peer,Mission.SpectatorTeam); // Missing bridge configuration never grants a combat side.
        return true;
    }
}
