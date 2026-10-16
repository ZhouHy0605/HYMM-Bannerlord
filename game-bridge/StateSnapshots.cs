namespace ArenaBridge;

// Small value-only copies made on the owning thread. No JSON round-trip and no
// Mission/Agent/Peer references cross the worker boundary.
public static class StateSnapshots
{
    public static Job Job(Job j)=>new(){Format=j.Format,Leg=j.Leg,MatchId=j.MatchId,Map=j.Map,Mode=j.Mode,
        Teams=j.Teams.Select(t=>t.ToArray()).ToArray(),Cultures=j.Cultures.ToArray(),RoundsToWin=j.RoundsToWin,ReservedBy=j.ReservedBy};
    public static CombatReport? Combat(CombatReport? r)=>r==null?null:new(){Version=r.Version,DrawRounds=r.DrawRounds,
        Players=r.Players.Select(p=>new CombatPlayer{Id=p.Id,Kills=p.Kills,Deaths=p.Deaths,Assists=p.Assists,Damage=p.Damage,
            Rounds=p.Rounds,Spawns=p.Spawns,HorseDamage=p.HorseDamage,NativeScore=p.NativeScore,
            Classes=new(){Infantry=p.Classes.Infantry,Archer=p.Classes.Archer,Cavalry=p.Classes.Cavalry}}).ToArray()};
    public static BridgeEvent Event(BridgeEvent e)=>new(){Leg=e.Leg,EventId=e.EventId,Type=e.Type,MatchId=e.MatchId,ServerId=e.ServerId,
        Map=e.Map,Teams=e.Teams?.Select(t=>t.ToArray()).ToArray(),Cultures=e.Cultures?.ToArray(),Score=e.Score?.ToArray(),Reason=e.Reason,Combat=Combat(e.Combat)};
    public static DurableState State(DurableState s)=>new(){LastControlId=s.LastControlId,ControlResult=s.ControlResult,ControlError=s.ControlError,
        Active=s.Active==null?null:Job(s.Active),Outbox=s.Outbox.Select(Event).ToList(),Blocked=s.Blocked};
}
