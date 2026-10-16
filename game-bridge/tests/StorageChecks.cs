using ArenaBridge;
using System.Collections.Concurrent;
using System.Diagnostics;
using System.Net;
using System.Text;
using System.Text.Json;

internal static class StorageChecks
{
    static void Check(bool value,string message){if(!value)throw new Exception("Background transport: "+message);}
    public static void Until(Func<bool> condition,Action? tick=null,int timeout=8000)
    {
        var watch=Stopwatch.StartNew();while(!condition()){if(watch.ElapsedMilliseconds>timeout)throw new Exception("Background check timed out");tick?.Invoke();Thread.Sleep(5);}
    }
    public static void WaitStored(Transport link){Until(()=>link.IsDurable,link.PollStorage);link.PollStorage();}
    static Config Config()=>new(){Token=new string('x',40)};
    static Job Job()=>new(){Format="two-leg-v1",MatchId="worker-test",Mode="Skirmish",Map="mp_skirmish_map_010",RoundsToWin=3,Cultures=new[]{"empire","vlandia"},Teams=Enumerable.Range(0,12).Select(i=>(76561198000000000L+i).ToString()).Chunk(6).ToArray()};
    sealed class Disk : IStateDisk
    {
        public readonly ManualResetEventSlim Reads=new(true),Writes=new(true),Archives=new(true);
        public readonly ConcurrentQueue<int> Threads=new();
        public readonly ConcurrentQueue<string> Order=new();
        public DurableState Saved=new();
        public DurableState? Archived;
        public int Failures;
        public bool Corrupt;
        public DurableState Read(){Threads.Enqueue(Environment.CurrentManagedThreadId);Reads.Wait();if(Corrupt)throw new InvalidDataException();return StateSnapshots.State(Saved);}
        public void Write(DurableState snapshot){Threads.Enqueue(Environment.CurrentManagedThreadId);Writes.Wait();if(Interlocked.Decrement(ref Failures)>=0)throw new IOException();Saved=StateSnapshots.State(snapshot);Order.Enqueue("state");}
        public void Archive(string id,DurableState snapshot){Threads.Enqueue(Environment.CurrentManagedThreadId);Archives.Wait();Archived=StateSnapshots.State(snapshot);Order.Enqueue("archive");}
    }
    sealed class Network : HttpMessageHandler
    {
        public readonly ConcurrentQueue<(string Path,string Body,int Thread)> Calls=new();
        public readonly HashSet<string> Accepted=new();
        public TaskCompletionSource<bool>? Gate;
        public int LoseAcknowledgements;
        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request,CancellationToken token)
        {
            string body=request.Content==null?"":await request.Content.ReadAsStringAsync(token);
            var path=request.RequestUri!.AbsolutePath;Calls.Enqueue((path,body,Environment.CurrentManagedThreadId));
            if(path.EndsWith("events"))
            {
                if(Gate!=null)await Gate.Task.WaitAsync(token);
                var e=JsonSerializer.Deserialize<BridgeEvent>(body,Transport.Json)!;
                lock(Accepted)Accepted.Add(e.EventId);
                if(Interlocked.Decrement(ref LoseAcknowledgements)>=0)throw new HttpRequestException("lost reply after acceptance");
            }
            return new(HttpStatusCode.OK){Content=new StringContent(path.EndsWith("jobs")?"[]":"{}",Encoding.UTF8,"application/json")};
        }
    }
    public static void Run()
    {
        int owner=Environment.CurrentManagedThreadId;
        var disk=new Disk();disk.Reads.Reset();var net=new Network();
        using(var link=new Transport(Config(),"unused",_=>{},disk,net))
        {
            var watch=Stopwatch.StartNew();for(int i=0;i<100;i++)link.Tick();
            Check(!link.IsDurable&&net.Calls.IsEmpty&&watch.ElapsedMilliseconds<500,"slow startup disk never blocks ticks or starts networking");
            disk.Reads.Set();WaitStored(link);
            var job=Job();link.State.Active=job;link.Save();WaitStored(link);
            disk.Writes.Reset();
            var report=new CombatReport{Version=2,Players=new[]{new CombatPlayer{Id="one",Damage=123,Classes=new(){Infantry=3}}}};
            var score=new[]{3,1};var id=link.Queue("finished",job,score,combat:report);
            // Mutating the original data cannot change a queued/persisted/uploaded report.
            report.Players[0].Damage=999;report.Players[0].Classes.Infantry=99;score[0]=0;job.Cultures[0]="changed";
            link.Queue("finished",job,score,combat:report);
            watch.Restart();for(int i=0;i<100;i++)link.Tick();
            Check(watch.ElapsedMilliseconds<500&&link.Pending(id)&&net.Calls.IsEmpty,"no upload before durable save, and no disk wait on main thread");
            SubModule.Link=link;
            var manager=TaleWorlds.MountAndBlade.ListedServer.ServerSideIntermissionManager.Instance;
            int starts=manager.Starts,ends=manager.Ends;
            try{Preparation.Begin(job,link);Preparation.Tick();Check(manager.Starts==starts&&manager.Ends==ends,"preparation cannot call native transition while persistence is pending");}
            finally{Preparation.Abort();SubModule.Link=null;}
            disk.Writes.Set();WaitStored(link);
            Check(disk.Saved.Outbox.Count==1&&disk.Saved.Outbox[0].Combat!.Players[0].Damage==123&&disk.Saved.Outbox[0].Combat!.Players[0].Classes.Infantry==3&&disk.Saved.Outbox[0].Score![0]==3,"snapshot deep copies score/combat and deduplicates");
            net.Gate=new(TaskCreationOptions.RunContinuationsAsynchronously);link.Tick();
            Until(()=>net.Calls.Any(c=>c.Path.EndsWith("events")));
            watch.Restart();for(int i=0;i<100;i++)link.Tick();Check(watch.ElapsedMilliseconds<500&&link.Pending(id),"slow HTTP never blocks Tick");
            disk.Writes.Reset();net.Gate.SetResult(true);
            Until(()=>link.State.Outbox.Count==0,link.Tick);
            Check(link.Pending(id)&&!Preparation.CanPlayIdle(link),"accepted event remains pending until acknowledgement persistence, no early server release");
            var crashState=StateSnapshots.State(disk.Saved);
            Check(crashState.Outbox.Single().EventId==id,"disk still contains replayable result during acknowledgement save");
            disk.Writes.Set();WaitStored(link);Check(!link.Pending(id)&&disk.Saved.Active==null,"release only after removal is persisted");
            Check(disk.Threads.All(t=>t!=owner)&&net.Calls.All(c=>c.Thread!=owner),"disk and network dispatch run outside owner thread");
            var replayDisk=new Disk{Saved=crashState};var replayNet=new Network{LoseAcknowledgements=1};
            using var replay=new Transport(Config(),"unused",_=>{},replayDisk,replayNet);WaitStored(replay);
            Until(()=>!replay.Pending(id),replay.Tick,12000);
            Check(replayNet.Calls.Count(c=>c.Path.EndsWith("events"))==2&&replayNet.Accepted.Count==1&&replayDisk.Saved.Outbox.Count==0,"restart replays same ID, lost response retries without duplicate result identity");
        }
        // Failed writes retain ownership and retry; a half is persisted atomically
        // with the next-leg ownership before any game-side reset can proceed.
        disk=new();net=new();
        using(var link=new Transport(Config(),"unused",_=>{},disk,net))
        {
            WaitStored(link);var job=Job();link.State.Active=job;link.Save();WaitStored(link);
            disk.Failures=1;
            var next=link.BeginSecondLeg(job,new[]{3,2},new(){Version=2});
            Until(()=>link.StorageError!=null,link.PollStorage);
            Check(!link.IsDurable&&net.Calls.IsEmpty,"failed write neither acknowledges nor uploads");
            WaitStored(link);Check(disk.Saved.Active?.Leg==1&&disk.Saved.Outbox.Single().Leg==0,"first result and next ownership persist together after retry");
            string id=link.Queue("started",next);WaitStored(link);
            Until(()=>!link.Pending(id),link.Tick);
            var events=net.Calls.Where(c=>c.Path.EndsWith("events")).Select(c=>JsonSerializer.Deserialize<BridgeEvent>(c.Body,Transport.Json)!).ToArray();
            Check(events.Length==2&&events[0].Type=="finished"&&events[0].Leg==0&&events[1].Type=="started"&&events[1].Leg==1&&link.State.Active?.Leg==1,"ordered delivery cannot erase next leg or start it before first result");
            var stop=new StopCommand{Id="cancel-test",MatchId=job.MatchId,Type="stop"};
            typeof(Transport).GetProperty(nameof(Transport.Control))!.SetValue(link,stop);
            disk.Archives.Reset();int before=net.Calls.Count;
            Check(!link.AcknowledgeStop(stop),"cancel begins asynchronous archive/save");
            for(int i=0;i<100;i++)link.Tick();
            Check(link.Control==stop&&!link.IsDurable&&!Preparation.CanPlayIdle(link)&&net.Calls.Count==before,"cancel cannot be exposed to heartbeat or release while archive is pending");
            disk.Archives.Set();WaitStored(link);
            Check(disk.Archived?.Active?.Leg==1&&disk.Saved.Active==null&&disk.Saved.LastControlId==stop.Id&&link.Control==null,"archive precedes durable cancellation and control release");
            Check(disk.Order.TakeLast(2).SequenceEqual(new[]{"archive","state"}),"archive is written before cleared state");
        }
        // An unreadable state file must never be replaced with an empty server.
        disk=new(){Corrupt=true};net=new();
        using(var link=new Transport(Config(),"unused",_=>{},disk,net))
        {Until(()=>link.StorageError!=null,link.PollStorage);for(int i=0;i<20;i++)link.Tick();Check(!link.IsDurable&&net.Calls.IsEmpty&&disk.Order.IsEmpty,"corrupt startup fails closed without overwriting or claiming");}
        disk=new();disk.Writes.Reset();
        using(var writer=new StateWriter(disk))
        {
            Until(()=>writer.Loaded.IsCompleted);var cumulative=new DurableState();long revision=0;
            for(int i=0;i<32;i++){cumulative.Outbox.Add(new(){EventId="event-"+i});revision=writer.Submit(StateSnapshots.State(cumulative));}
            Check(writer.Persisted==0,"blocked writer has not confirmed any snapshot");
            disk.Writes.Set();Until(()=>writer.Persisted>=revision);
            Check(disk.Saved.Outbox.Count==32&&disk.Order.Count<=2,"bounded coalescing retains every event in latest cumulative snapshot without stale overwrite");
        }
        var dir=Path.Combine(Path.GetTempPath(),"hymm-writer-"+Guid.NewGuid());
        try
        {
            var file=Path.Combine(dir,"state.json");var real=new StateDisk(file);
            using(var writer=new StateWriter(real))
            {
                Until(()=>writer.Loaded.IsCompleted);
                var state=new DurableState{Active=Job(),Outbox=new(){new BridgeEvent{EventId="durable",Type="finished"}}};
                long revision=writer.Submit(StateSnapshots.State(state));Until(()=>writer.Persisted>=revision);
            }
            Check(real.Read().Outbox.Single().EventId=="durable"&&!File.Exists(file+".tmp"),"real disk atomic replacement reloads complete JSON");
        }
        finally{if(Directory.Exists(dir))Directory.Delete(dir,true);}
        Console.WriteLine("Background disk/network, snapshots, retries, replay and persistence gates passed");
    }
}
