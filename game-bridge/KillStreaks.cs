namespace ArenaBridge;

// Keys represent individual spawned agents, not accounts: a new life starts fresh.
internal sealed class KillStreaks
{
    internal const double WindowSeconds=15;
    readonly Dictionary<object,(int count,double time)> streaks=new();
    readonly HashSet<object> removed=new();
    public void Reset(){streaks.Clear();removed.Clear();}
    public void Forget(object life)=>streaks.Remove(life);
    public int Removed(object victim,object? attacker,bool enemyPlayerKill,double now)
    {
        if(!removed.Add(victim))return 0;
        streaks.Remove(victim);
        if(!enemyPlayerKill||attacker==null||ReferenceEquals(attacker,victim)||removed.Contains(attacker))return 0;
        int count=streaks.TryGetValue(attacker,out var old)&&now>=old.time&&now-old.time<WindowSeconds?old.count+1:1;
        streaks[attacker]=(count,now);
        return count>=3?count:0;
    }
}
