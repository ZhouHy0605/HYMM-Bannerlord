using System.Text.Json;
using System.Net.Http.Headers;

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
// Only Tick and Queue touch state, on the mission thread. HTTP tasks never access game objects.
public sealed class Transport : IDisposable
{
    public static readonly JsonSerializerOptions Json = new() { PropertyNamingPolicy=JsonNamingPolicy.CamelCase, PropertyNameCaseInsensitive=true, WriteIndented=true };
    readonly HttpClient http;
    readonly string path;
    readonly Action<string> log;
    Task<HttpResponseMessage>? sending;
    DateTime retryAt;
    Task<HttpResponseMessage>? heartbeat;
    DateTime nextHeartbeat;
    public StopCommand? Control {get;private set;}
    public DurableState State { get; }
    public Config Config { get; }
    public string? CurrentMap {get;set;}
    public Transport(Config config,string statePath,Action<string> logger)
    {
        config.Validate();Config=config;path=statePath;log=logger;
        State=File.Exists(path)?JsonSerializer.Deserialize<DurableState>(File.ReadAllText(path),Json)!:new();
        http=new HttpClient { BaseAddress=new Uri(config.BaseUrl.TrimEnd('/')+"/"), Timeout=TimeSpan.FromSeconds(10) };
        http.DefaultRequestHeaders.Authorization=new AuthenticationHeaderValue("Bearer",config.Token);
        // An interrupted mission is never reconstructed from a score guess.
        if(State.Active!=null && !State.Outbox.Any(e=>e.MatchId==State.Active.MatchId&&e.Leg==State.Active.Leg&&(e.Type is "finished" or "failed"))) Queue("failed",State.Active,reason:"bridge_process_restarted");
    }
    public void Save()
    {
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        File.WriteAllText(path+".tmp",JsonSerializer.Serialize(State,Json));File.Move(path+".tmp",path,true);
    }
    public string Queue(string type,Job j,int[]? score=null,string? reason=null,CombatReport? combat=null)
    {
        var item=CreateEvent(type,j,score,reason,combat);
        if(State.Outbox.Any(e=>e.EventId==item.EventId))return item.EventId;
        State.Outbox.Add(item);Save();return item.EventId;
    }
    BridgeEvent CreateEvent(string type,Job j,int[]? score=null,string? reason=null,CombatReport? combat=null)
        =>new BridgeEvent { Leg=j.Leg,EventId=j.Format=="two-leg-v1"?$"{j.MatchId}:leg{j.Leg}:{type}":$"{j.MatchId}:{type}",Type=type,MatchId=j.MatchId,ServerId=Config.ServerId,
            Map=type=="started"?j.Map:null,Teams=type=="started"?j.Teams:null,Cultures=type=="started"?j.Cultures:null,Score=score,Reason=reason,Combat=combat };
    public Job BeginSecondLeg(Job first,int[] score,CombatReport report)
    {
        var next=Policy.SecondLeg(first);
        if(State.Active?.MatchId!=first.MatchId||State.Active.Leg!=0||State.Outbox.Count!=0||score.Length!=2||!Policy.FinalScore(score[0],score[1])||report.Version!=2)throw new Exception("invalid_second_leg_transition");
        // Persist the first result and next-leg ownership together. An acknowledgement
        // for leg zero must not clear the active second leg. No second claim is needed:
        // the website keeps this server's reservation across both legs.
        State.Outbox.Add(CreateEvent("finished",first,score,combat:report));State.Active=next;Save();return next;
    }
    public bool Pending(string id)=>State.Outbox.Any(e=>e.EventId==id);
    public void Tick()
    {
        PollHeartbeat();
        if(State.Blocked!=null)return;
        if(sending!=null && sending.IsCompleted)
        {
            try
            {
                using var response=sending.GetAwaiter().GetResult();
                if(response.IsSuccessStatusCode)
                {
                    var e=State.Outbox[0];State.Outbox.RemoveAt(0);
                    if((e.Type is "finished" or "failed")&&State.Active?.MatchId==e.MatchId&&State.Active.Leg==e.Leg)State.Active=null;
                    Save();log($"Event acknowledged: {e.Type} {e.MatchId}");
                }
                else if((int)response.StatusCode>=400 && (int)response.StatusCode<500 && (int)response.StatusCode!=429)
                { State.Blocked=$"HTTP {(int)response.StatusCode}: {State.Outbox[0].EventId}";Save();log(State.Blocked); }
                else retryAt=DateTime.UtcNow.AddSeconds(5);
            }
            catch(Exception e){log("Delivery retry: "+e.GetType().Name);retryAt=DateTime.UtcNow.AddSeconds(5);}
            sending=null;
        }
        if(sending==null && State.Blocked==null && State.Outbox.Count>0 && DateTime.UtcNow>=retryAt)
            sending=http.PostAsync("api/bridge/events",Content(State.Outbox[0]));
    }
    static StringContent Content(object b)=>new(JsonSerializer.Serialize(b,Json),System.Text.Encoding.UTF8,"application/json");
    public async Task<Job?> Claim(string? map=null)
    {
        using var response=await http.GetAsync("api/bridge/jobs");response.EnsureSuccessStatusCode();
        var jobs=JsonSerializer.Deserialize<Job[]>(await response.Content.ReadAsStringAsync(),Json)!;
        var job=jobs.Where(j=>Policy.Valid(j,map)&&(j.ReservedBy==null||j.ReservedBy==Config.ServerId)).OrderByDescending(j=>j.ReservedBy==Config.ServerId).FirstOrDefault();
        if(job==null)return null;
        using var claimed=await http.PostAsync("api/bridge/claim",Content(new {matchId=job.MatchId,serverId=Config.ServerId,map=job.Map}));
        if((int)claimed.StatusCode==409)return null;claimed.EnsureSuccessStatusCode();
        return JsonSerializer.Deserialize<Job>(await claimed.Content.ReadAsStringAsync(),Json);
    }
    public void Dispose()=>http.Dispose();
    public async Task<Dictionary<string,Dictionary<string,string[]>>> FetchArmory(string[] ids)
    {
        using var response=await http.PostAsync("api/bridge/armory",Content(new{ids}));
        response.EnsureSuccessStatusCode();
        return JsonSerializer.Deserialize<ArmoryReply>(await response.Content.ReadAsStringAsync(),Json)?.Profiles??new();
    }
    void PollHeartbeat()
    {
        if(heartbeat?.IsCompleted==true){try{using var response=heartbeat.GetAwaiter().GetResult();if(response.IsSuccessStatusCode){var payload=JsonSerializer.Deserialize<ControlReply>(response.Content.ReadAsStringAsync().GetAwaiter().GetResult(),Json);if(payload?.Control!=null&&payload.Control.Id!=State.LastControlId)Control=payload.Control;}}catch(Exception e){log("Heartbeat retry: "+e.GetType().Name);}heartbeat=null;}
        if(heartbeat==null&&DateTime.UtcNow>=nextHeartbeat){nextHeartbeat=DateTime.UtcNow.AddSeconds(5);heartbeat=http.PostAsync("api/bridge/heartbeat",Content(new{serverId=Config.ServerId,matchId=State.Active?.MatchId,blocked=State.Blocked!=null,version="arena-0.4.6",ackId=State.LastControlId,idleMapSupported=true,currentMap=CurrentMap,controlResult=State.ControlResult,controlError=State.ControlError}));}
    }
    public void CompleteMapControl(StopCommand command,string? error=null){State.LastControlId=command.Id;State.ControlResult=error==null?"ok":"failed";State.ControlError=error;Save();Control=null;nextHeartbeat=DateTime.MinValue;}
    public bool AcknowledgeStop(StopCommand command)
    {
        if(sending!=null)return false;
        if(State.Active!=null&&State.Active.MatchId!=command.MatchId)return false;
        // Preserve every queued event as evidence before clearing a cancelled mission.
        File.WriteAllText(path+".control-"+command.Id+".json",JsonSerializer.Serialize(State,Json));
        State.Outbox.RemoveAll(e=>e.MatchId==command.MatchId);State.Active=null;State.Blocked=null;State.LastControlId=command.Id;Save();Control=null;nextHeartbeat=DateTime.MinValue;return true;
    }
}
public sealed class StopCommand{public string Id {get;set;}="";public string MatchId{get;set;}="";public string Type{get;set;}="";public string Map{get;set;}="";public long ExpiresAt{get;set;}}
public sealed class ControlReply{public StopCommand? Control{get;set;}}
public sealed class ArmoryReply{public Dictionary<string,Dictionary<string,string[]>> Profiles{get;set;}=new();}
