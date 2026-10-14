using TaleWorlds.MountAndBlade;
using TaleWorlds.MountAndBlade.ListedServer;
namespace ArenaBridge;
internal static class Operations
{
 static DateTime nextStop;
 public static void Tick()
 {
  var link=SubModule.Link;var command=link?.Control;if(link==null||command==null||command.Type!="stop")return;
  if(link.State.Active!=null&&link.State.Active.MatchId!=command.MatchId)return;
  if(!Preparation.Abort())return;
  if(Mission.Current!=null){
   var behavior=Mission.Current.GetMissionBehavior<ArenaBehavior>();if(behavior!=null&&!behavior.StopByAdmin(command.MatchId))return;
   if(DateTime.UtcNow>=nextStop){nextStop=DateTime.UtcNow.AddSeconds(2);ServerSideIntermissionManager.Instance?.EndMission();}return;
  }
  if(link.AcknowledgeStop(command))SubModule.Log("Administrative stop completed; server release acknowledged");
 }
}
