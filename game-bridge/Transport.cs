using System.Text.Json;
using System.Net.Http.Headers;

namespace ArenaBridge;

// Game-thread state owner. Workers receive detached values and return typed
// results; only Tick/PollStorage apply completions to the live state machine.
public sealed class Transport : IDisposable
{
    public static readonly JsonSerializerOptions Json=new(){PropertyNamingPolicy=JsonNamingPolicy.CamelCase,PropertyNameCaseInsensitive=true,WriteIndented=true};
    readonly HttpClient http;
    readonly StateWriter writer;
    readonly Action<string> log;
    Task<int>? sending;
    Task<ControlReply?>? heartbeat;
    DateTime retryAt,nextHeartbeat;
    long saveRevision;
    bool initialized,loadFailed;
    string? reportedError,controlCommit;
    public StopCommand? Control {get;private set;}
    public DurableState State {get;private set;}=new();
    public Config Config {get;}
    public string? CurrentMap {get;set;}
    public bool IsDurable=>initialized&&!loadFailed&&writer.Persisted>=saveRevision;
    public string? StorageError=>writer.Error;
    public Transport(Config config,string statePath,Action<string> logger,IStateDisk? disk=null,HttpMessageHandler? handler=null)
    {
        config.Validate();Config=config;log=logger;
        http=handler==null?new HttpClient():new HttpClient(handler);
        http.BaseAddress=new Uri(config.BaseUrl.TrimEnd('/')+"/");http.Timeout=TimeSpan.FromSeconds(10);
        http.DefaultRequestHeaders.Authorization=new AuthenticationHeaderValue("Bearer",config.Token);
        writer=new StateWriter(disk??new StateDisk(statePath));
    }
    public void PollStorage()
    {
        if(!initialized&&!loadFailed&&writer.Loaded.IsCompleted)
        {
            try
            {
                State=writer.Loaded.GetAwaiter().GetResult();initialized=true;
                if(State.Active!=null&&!State.Outbox.Any(e=>e.MatchId==State.Active.MatchId&&e.Leg==State.Active.Leg&&(e.Type is "finished" or "failed")))
                    Queue("failed",State.Active,reason:"bridge_process_restarted");
            }
            catch(Exception e){loadFailed=true;log("State load blocked: "+e.GetType().Name);}
        }
        var error=writer.Error;
        if(error!=reportedError){if(error!=null)log("State persistence pending: "+error);else if(reportedError!=null)log("State persistence recovered");reportedError=error;}
        if(IsDurable&&controlCommit!=null)
        {
            if(Control?.Id==controlCommit)Control=null;
            log("Control persisted: "+controlCommit);controlCommit=null;nextHeartbeat=DateTime.MinValue;
        }
    }
    public void Save()=>Save(null,null);
    void Save(string? archiveId,DurableState? archive)
    {
        if(!initialized||loadFailed)throw new InvalidOperationException("State not loaded");
        saveRevision=writer.Submit(StateSnapshots.State(State),archiveId,archive);
    }
    public string Queue(string type,Job j,int[]? score=null,string? reason=null,CombatReport? combat=null)
    {
        var item=CreateEvent(type,j,score,reason,combat);
        if(State.Outbox.Any(e=>e.EventId==item.EventId))return item.EventId;
        State.Outbox.Add(item);Save();return item.EventId;
    }
    BridgeEvent CreateEvent(string type,Job j,int[]? score=null,string? reason=null,CombatReport? combat=null)
        =>new(){Leg=j.Leg,EventId=j.Format=="two-leg-v1"?$"{j.MatchId}:leg{j.Leg}:{type}":$"{j.MatchId}:{type}",Type=type,MatchId=j.MatchId,ServerId=Config.ServerId,
            Map=type=="started"?j.Map:null,Teams=type=="started"?j.Teams.Select(t=>t.ToArray()).ToArray():null,
            Cultures=type=="started"?j.Cultures.ToArray():null,Score=score?.ToArray(),Reason=reason,Combat=StateSnapshots.Combat(combat)};
    public Job BeginSecondLeg(Job first,int[] score,CombatReport report)
    {
        var next=Policy.SecondLeg(first);
        if(!IsDurable||State.Active?.MatchId!=first.MatchId||State.Active.Leg!=0||State.Outbox.Count!=0||score.Length!=2||!Policy.FinalScore(score[0],score[1])||report.Version!=2)
            throw new Exception("invalid_second_leg_transition");
        State.Outbox.Add(CreateEvent("finished",first,score,combat:report));State.Active=next;Save();return next;
    }
    public bool Pending(string id)=>!IsDurable||State.Outbox.Any(e=>e.EventId==id);
    public void Tick()
    {
        PollStorage();if(!IsDurable)return;
        PollHeartbeat();
        if(State.Blocked!=null)return;
        if(sending?.IsCompleted==true)
        {
            try
            {
                int status=sending.GetAwaiter().GetResult();
                if(status>=200&&status<300)
                {
                    var e=State.Outbox[0];State.Outbox.RemoveAt(0);
                    if((e.Type is "finished" or "failed")&&State.Active?.MatchId==e.MatchId&&State.Active.Leg==e.Leg)State.Active=null;
                    Save();log($"Event accepted; saving acknowledgement: {e.Type} {e.MatchId}");
                }
                else if(status>=400&&status<500&&status!=429){State.Blocked=$"HTTP {status}: {State.Outbox[0].EventId}";Save();log(State.Blocked);}
                else retryAt=DateTime.UtcNow.AddSeconds(5);
            }
            catch(Exception e){log("Delivery retry: "+e.GetType().Name);retryAt=DateTime.UtcNow.AddSeconds(5);}
            sending=null;
        }
        if(IsDurable&&sending==null&&State.Blocked==null&&State.Outbox.Count>0&&DateTime.UtcNow>=retryAt)
        {
            var snapshot=StateSnapshots.Event(State.Outbox[0]);
            sending=Task.Run(async()=>{using var content=Content(snapshot);using var response=await http.PostAsync("api/bridge/events",content).ConfigureAwait(false);return (int)response.StatusCode;});
        }
    }
    static StringContent Content(object b)=>new(JsonSerializer.Serialize(b,Json),System.Text.Encoding.UTF8,"application/json");
    public Task<Job?> Claim(string? map=null)
    {
        if(!IsDurable)throw new InvalidOperationException("State persistence pending");
        var serverId=Config.ServerId;
        return Task.Run(async()=>{
            using var response=await http.GetAsync("api/bridge/jobs").ConfigureAwait(false);response.EnsureSuccessStatusCode();
            var jobs=JsonSerializer.Deserialize<Job[]>(await response.Content.ReadAsStringAsync().ConfigureAwait(false),Json)!;
            var job=jobs.Where(j=>Policy.Valid(j,map)&&(j.ReservedBy==null||j.ReservedBy==serverId)).OrderByDescending(j=>j.ReservedBy==serverId).FirstOrDefault();
            if(job==null)return null;
            using var content=Content(new{matchId=job.MatchId,serverId,map=job.Map});
            using var claimed=await http.PostAsync("api/bridge/claim",content).ConfigureAwait(false);
            if((int)claimed.StatusCode==409)return null;claimed.EnsureSuccessStatusCode();
            return JsonSerializer.Deserialize<Job>(await claimed.Content.ReadAsStringAsync().ConfigureAwait(false),Json);
        });
    }
    public Task<ArmoryReply> FetchArmory(string[] ids,Dictionary<string,string> versions)
    {
        var snapshotIds=ids.ToArray();var snapshotVersions=new Dictionary<string,string>(versions);
        return Task.Run(async()=>{
            using var content=Content(new{ids=snapshotIds,versions=snapshotVersions});
            using var response=await http.PostAsync("api/bridge/armory",content).ConfigureAwait(false);response.EnsureSuccessStatusCode();
            return ArmoryCache.Normalize(JsonSerializer.Deserialize<ArmoryReply>(await response.Content.ReadAsStringAsync().ConfigureAwait(false),Json)??throw new InvalidDataException("Empty armory response"));
        });
    }
    void PollHeartbeat()
    {
        if(heartbeat?.IsCompleted==true)
        {
            try{var payload=heartbeat.GetAwaiter().GetResult();if(payload?.Control!=null&&payload.Control.Id!=State.LastControlId)Control=payload.Control;}
            catch(Exception e){log("Heartbeat retry: "+e.GetType().Name);}heartbeat=null;
        }
        if(heartbeat==null&&DateTime.UtcNow>=nextHeartbeat)
        {
            nextHeartbeat=DateTime.UtcNow.AddSeconds(5);
            var snapshot=new{serverId=Config.ServerId,matchId=State.Active?.MatchId,blocked=State.Blocked!=null,version="arena-0.4.11",ackId=State.LastControlId,
                idleMapSupported=true,currentMap=CurrentMap,controlResult=State.ControlResult,controlError=State.ControlError};
            heartbeat=Task.Run(async()=>{using var content=Content(snapshot);using var response=await http.PostAsync("api/bridge/heartbeat",content).ConfigureAwait(false);
                response.EnsureSuccessStatusCode();return JsonSerializer.Deserialize<ControlReply>(await response.Content.ReadAsStringAsync().ConfigureAwait(false),Json);});
        }
    }
    public void CompleteMapControl(StopCommand command,string? error=null)
    {
        if(!IsDurable)throw new InvalidOperationException("State persistence pending");
        State.LastControlId=command.Id;State.ControlResult=error==null?"ok":"failed";State.ControlError=error;
        Save();controlCommit=command.Id;
    }
    public bool AcknowledgeStop(StopCommand command)
    {
        if(!IsDurable||sending!=null)return false;
        if(State.LastControlId==command.Id)return true;
        if(State.Active!=null&&State.Active.MatchId!=command.MatchId)return false;
        var archive=StateSnapshots.State(State);
        State.Outbox.RemoveAll(e=>e.MatchId==command.MatchId);State.Active=null;State.Blocked=null;State.LastControlId=command.Id;
        State.ControlResult=null;State.ControlError=null;Save(command.Id,archive);controlCommit=command.Id;
        return false; // Only PollStorage may expose the completed control to heartbeat.
    }
    public void Dispose()
    {
        writer.Dispose();if(!IsDurable)log("Shutdown with persistence pending; last durable state retained");http.Dispose();
    }
}
