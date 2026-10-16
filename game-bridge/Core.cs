
namespace ArenaBridge;

public sealed class Config
{
    public string BaseUrl { get; set; } = "http://127.0.0.1:3210/";
    public string ServerId { get; set; } = "skirmish-1";
    public string Token { get; set; } = "";
    public int ArrivalTimeoutSeconds { get; set; } = 300;
    public bool EnableArmory {get;set;} = false;
    public string[] JoinMessages {get;set;}=Array.Empty<string>();
    // Explicit pool excludes native developer scenes; custom entries must also be registered.
    public string[] IdleMaps {get;set;}=new[]{"mp_skirmish_map_002f","mp_skirmish_map_003_skinc","mp_skirmish_map_010","mp_skirmish_map_007","mp_skirmish_map_008_skin","mp_skirmish_map_009","mp_skirmish_map_014","mp_skirmish_map_020"};
    // Populated only after verifying an authenticated game ID against its Steam account.
    public Dictionary<string,string> GameIdToSteamId { get; set; } = new();
    public void Validate()
    {
        var uri = new Uri(BaseUrl);
        if (uri.Scheme != "https" && !(uri.Scheme == "http" && uri.IsLoopback)) throw new Exception("Use HTTPS outside localhost");
        if (Token.Length < 32 || string.IsNullOrWhiteSpace(ServerId) || ServerId.Length > 80) throw new Exception("Set token (32+ characters) and server ID");
        if (ArrivalTimeoutSeconds < 60 || ArrivalTimeoutSeconds > 3600) throw new Exception("Invalid arrival timeout");
        if(JoinMessages==null||JoinMessages.Length>10||JoinMessages.Any(s=>string.IsNullOrWhiteSpace(s)||s.Length>240||s.Any(char.IsControl)))throw new Exception("Invalid join messages");
        if(IdleMaps==null||IdleMaps.Length==0||IdleMaps.Length>100||IdleMaps.Any(m=>string.IsNullOrEmpty(m)||m.Length>100||m.Any(c=>!(c>='a'&&c<='z'||c>='A'&&c<='Z'||c>='0'&&c<='9'||c=='_')))||IdleMaps.Distinct().Count()!=IdleMaps.Length)throw new Exception("Invalid idle map pool");
        if (GameIdToSteamId.Values.Any(x => !Policy.IsSteamId(x)) || GameIdToSteamId.Values.Distinct().Count()!=GameIdToSteamId.Count) throw new Exception("Invalid or duplicate identity mapping");
    }
}
public sealed class Job
{
    public string Format {get;set;}="single-v1";
    public int Leg {get;set;}
    public string MatchId { get; set; } = "";
    public string Map { get; set; } = "";
    public string Mode { get; set; } = "";
    public string[][] Teams { get; set; } = Array.Empty<string[]>();
    public string[] Cultures {get;set;}=Array.Empty<string>();
    public int RoundsToWin { get; set; }
    public string? ReservedBy { get; set; }
}
public sealed class CombatPlayer
{
 public string Id {get;set;}="";
 public int Kills {get;set;}
 public int Deaths {get;set;}
 public int Assists {get;set;}
 public int Damage {get;set;}
 public int Rounds {get;set;}
 public int Spawns {get;set;}
 public int HorseDamage {get;set;}
 public int NativeScore {get;set;}
 public CombatClasses Classes {get;set;}=new();
}
public sealed class CombatClasses
{
 public int Infantry {get;set;}
 public int Archer {get;set;}
 public int Cavalry {get;set;}
}
// One classification per life; mounting later promotes that life to cavalry.
// Dismounting or losing a horse cannot turn a cavalry life into infantry.
public sealed class CombatSpawns
{
 readonly Dictionary<object,(CombatPlayer player,int role)> seen=new();
 public void BeginRound()=>seen.Clear();
 public void Observe(object life,CombatPlayer player,bool mounted,bool ranged)
 {
  if(seen.TryGetValue(life,out var old)){
   if(mounted&&old.role!=2){if(old.role==0)old.player.Classes.Infantry--;else old.player.Classes.Archer--;old.player.Classes.Cavalry++;seen[life]=(old.player,2);}return;
  }
  int role=mounted?2:ranged?1:0;seen[life]=(player,role);player.Spawns++;
  if(role==2)player.Classes.Cavalry++;else if(role==1)player.Classes.Archer++;else player.Classes.Infantry++;
 }
}
public sealed class CombatReport
{
 public int Version {get;set;}=1;
 public int DrawRounds {get;set;}
 public CombatPlayer[] Players {get;set;}=Array.Empty<CombatPlayer>();
}
public sealed class BridgeEvent
{
    public int Leg {get;set;}
    public string EventId { get; set; } = "";
    public string Type { get; set; } = "";
    public string MatchId { get; set; } = "";
    public string ServerId { get; set; } = "";
    public string? Map { get; set; }
    public string[][]? Teams { get; set; }
    public string[]? Cultures {get;set;}
    public int[]? Score { get; set; }
    public string? Reason { get; set; }
    public CombatReport? Combat {get;set;}
}
public static class Policy
{
    public static bool SupportsRankedMap(string map,IEnumerable<string> native,IEnumerable<string> registeredSkirmish)=>native.Contains(map)||registeredSkirmish.Contains(map);
    public static string[] IdleMapPool(Config config,IEnumerable<string> native,IEnumerable<string> registered)=>config.IdleMaps.Where(m=>native.Contains(m)||registered.Contains(m)).ToArray();
    public static bool IsSteamId(string s) => s.Length == 17 && s.All(c=>c>='0'&&c<='9');
    public static readonly string[] Cultures={"khuzait","aserai","battania","vlandia","sturgia","empire"};
    public static bool Valid(Job j, string? map) => (j.Format=="single-v1"&&j.Leg==0||j.Format=="two-leg-v1"&&j.Leg is 0 or 1) && j.Mode=="Skirmish" && !string.IsNullOrEmpty(j.Map) && (map==null||j.Map==map) && j.Cultures.Length==2 && j.Cultures[0]!=j.Cultures[1] && j.Cultures.All(Cultures.Contains) && j.RoundsToWin==3 &&
        !string.IsNullOrEmpty(j.MatchId) && j.Teams.Length==2 && j.Teams.All(t=>t.Length==6) &&
        j.Teams.SelectMany(t=>t).All(IsSteamId) && j.Teams.SelectMany(t=>t).Distinct().Count()==12;
    // A/B are fixed rosters; their physical sides swap in leg two. Never infer identity from names.
    public static int Team(Job j,string? steamId) => steamId!=null && j.Teams[0].Contains(steamId)?0:steamId!=null && j.Teams[1].Contains(steamId)?1:-1;
    public static int Side(Job j,string? steamId){int team=Team(j,steamId);return team<0?-1:j.Leg==1?1-team:team;}
    // Only an explicit auto-assign request admits a roster member for this mission.
    public static int SelectionSide(Job? j,string? steamId,bool admitted,bool autoAssign=false,bool spectator=false)
        => j==null||spectator||(!admitted&&!autoAssign)?-1:Side(j,steamId);
    public static int[] OriginalScore(Job j,int attacker,int defender)=>j.Leg==1?new[]{defender,attacker}:new[]{attacker,defender};
    public static bool FinalScore(int a,int b) => (a==3 && b>=0 && b<3)||(b==3 && a>=0 && a<3);
    // Native RoundTotal is a played-round cap, not wins needed. Extend it after
    // draws, then end at the current round when either side reaches three wins.
    public static int RoundLimit(int rounds,int attacker,int defender,bool continueInPlace=false)
    {
        if(rounds<1||rounds>99||attacker<0||defender<0||attacker>3||defender>3||attacker+defender>rounds||attacker==3&&defender==3)throw new Exception("invalid_round_score");
        if(FinalScore(attacker,defender)&&!continueInPlace)return rounds;
        if(rounds==99)throw new Exception("round_safety_limit");
        return Math.Max(continueInPlace?7:5,rounds+1);
    }
    public static Job SecondLeg(Job first)
    {
        if(!Valid(first,null)||first.Format!="two-leg-v1"||first.Leg!=0)throw new Exception("invalid_second_leg_transition");
        return new Job{Format=first.Format,Leg=1,MatchId=first.MatchId,Map=first.Map,Mode=first.Mode,
            Teams=first.Teams.Select(t=>t.ToArray()).ToArray(),Cultures=first.Cultures.ToArray(),RoundsToWin=first.RoundsToWin,ReservedBy=first.ReservedBy};
    }
}
public sealed class DurableState
{
    public string? LastControlId {get;set;}
    public string? ControlResult {get;set;}
    public string? ControlError {get;set;}
    public Job? Active { get; set; }
    public List<BridgeEvent> Outbox { get; set; } = new();
    public string? Blocked { get; set; }
}
public sealed class StopCommand{public string Id {get;set;}="";public string MatchId{get;set;}="";public string Type{get;set;}="";public string Map{get;set;}="";public long ExpiresAt{get;set;}}
public sealed class ControlReply{public StopCommand? Control{get;set;}}
public sealed class ArmoryReply{public Dictionary<string,Dictionary<string,string[]>> Profiles{get;set;}=new();public Dictionary<string,string> Versions{get;set;}=new();}
