namespace ArenaBridge;

// Diagnostics only. Match events retain the synchronous durable outbox in Core.
public sealed class BufferedDiagnosticLog : IDisposable
{
    readonly object gate=new();
    readonly Queue<string> queue=new();
    readonly Action<string> sink;
    readonly Thread worker;
    readonly int capacity;
    bool stopping;
    string? last;
    long repeated,dropped,repeatSince;
    public BufferedDiagnosticLog(Action<string> sink,int capacity=1024)
    {
        this.sink=sink;this.capacity=Math.Max(1,capacity);
        worker=new Thread(Run){IsBackground=true,Name="HYMM diagnostics"};worker.Start();
    }
    public static BufferedDiagnosticLog ToFile(string path)=>new(text=>{
        if(File.Exists(path)&&new FileInfo(path).Length>5*1024*1024)File.Move(path,path+".1",true);
        File.AppendAllText(path,text);
        Console.Write(text);
    });
    void Enqueue(string text)
    {
        if(queue.Count>=capacity){dropped++;return;}
        queue.Enqueue(DateTimeOffset.UtcNow.ToString("o")+" [ArenaBridge] "+text+Environment.NewLine);
    }
    void Repeats()
    {
        if(repeated>0){Enqueue("Previous diagnostic repeated "+repeated+" times: "+last);repeated=0;}
    }
    public void Write(string text)
    {
        // Bound individual diagnostics as well as the queue during error storms.
        if(text.Length>4096)text=text[..4096]+" [truncated]";
        lock(gate)
        {
            if(stopping)return;
            if(last==text){repeated++;return;}
            Repeats();last=text;repeatSince=Environment.TickCount64;Enqueue(text);
        }
    }
    void Run()
    {
        while(true)
        {
            string[] lines;string omission="";bool done;
            lock(gate)
            {
                if(!stopping)Monitor.Wait(gate,250);
                if(stopping||Environment.TickCount64-repeatSince>=5000){Repeats();last=null;}
                lines=queue.ToArray();queue.Clear();
                if(dropped>0){omission=DateTimeOffset.UtcNow.ToString("o")+" [ArenaBridge] Diagnostics omitted (queue full or sink failure): "+dropped+Environment.NewLine;dropped=0;}
                done=stopping;
            }
            var batch=string.Concat(lines)+omission;
            if(batch.Length>0)try{sink(batch);}catch{lock(gate){dropped++;}}
            if(done)return;
        }
    }
    public void Dispose()
    {
        lock(gate){stopping=true;Monitor.PulseAll(gate);}
        // An unavailable disk/console must not stall shutdown indefinitely.
        if(Thread.CurrentThread!=worker)worker.Join(2000);
    }
}
