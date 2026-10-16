using TaleWorlds.MountAndBlade;
namespace ArenaBridge;
internal static class Operations
{
 public static void Tick()
 {
  var link=SubModule.Link;var command=link?.Control;if(link==null||!link.IsDurable||command==null||command.Type!="stop")return;
  if(link.State.Active!=null&&link.State.Active.MatchId!=command.MatchId)return;
  if(!Preparation.Abort())return;
  if(Mission.Current!=null){
   var behavior=Mission.Current.GetMissionBehavior<ArenaBehavior>();if(behavior!=null&&!behavior.StopByAdmin(command.MatchId))return;
   MissionRetirement.Request(Mission.Current,"admin-stop");return;
  }
  if(link.AcknowledgeStop(command))SubModule.Log("Administrative stop completed; server release acknowledged");
 }
}
