namespace ArenaBridge;

// Keep all roster records, including offline players. Native reconnects reuse a
// MissionPeer; a fresh connection has a new counter session starting at zero.
public sealed class CombatLedger
{
    public Dictionary<string,CombatPlayer> Players {get;}
    readonly Dictionary<object,(string id,int kills,int deaths,int assists,int score)> samples=new();
    public CombatLedger(IEnumerable<string> ids)=>Players=ids.ToDictionary(id=>id,id=>new CombatPlayer{Id=id});
    public void BeginRound()=>samples.Clear();
    public void Observe(string id,object session,int kills,int deaths,int assists,bool baselineOnly=false,int score=0)
    {
        if(!Players.TryGetValue(id,out var player))return;
        var before=samples.TryGetValue(session,out var last)?last:(id,0,0,0,0);
        if(!baselineOnly){
            player.Kills+=Math.Max(0,kills-before.Item2);
            player.Deaths+=Math.Max(0,deaths-before.Item3);
            player.Assists+=Math.Max(0,assists-before.Item4);
            // Preserve native friendly-fire/suicide deductions, not just gains.
            player.NativeScore+=score-before.Item5;
        }
        samples[session]=(id,kills,deaths,assists,score);
    }
    public void EndRound(){foreach(var player in Players.Values)player.Rounds++;}
}
