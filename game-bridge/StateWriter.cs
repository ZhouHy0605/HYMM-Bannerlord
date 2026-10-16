using System.Text.Json;

namespace ArenaBridge;

public interface IStateDisk
{
    DurableState Read();
    void Write(DurableState snapshot);
    void Archive(string controlId,DurableState snapshot);
}
public sealed class StateDisk : IStateDisk
{
    readonly string path;
    public StateDisk(string path){this.path=path;}
    public DurableState Read()=>File.Exists(path)?JsonSerializer.Deserialize<DurableState>(File.ReadAllText(path),Transport.Json)
        ??throw new InvalidDataException("Empty durable state"):new();
    static void AtomicWrite(string path,DurableState snapshot)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        var bytes=JsonSerializer.SerializeToUtf8Bytes(snapshot,Transport.Json);
        using(var file=new FileStream(path+".tmp",FileMode.Create,FileAccess.Write,FileShare.None))
        {file.Write(bytes);file.Flush(true);}
        File.Move(path+".tmp",path,true);
    }
    public void Write(DurableState snapshot)=>AtomicWrite(path,snapshot);
    public void Archive(string controlId,DurableState snapshot)
    {
        if(string.IsNullOrEmpty(controlId)||controlId.Length>120||controlId.Any(c=>!(c>='a'&&c<='z'||c>='A'&&c<='Z'||c>='0'&&c<='9')&&c!='-'&&c!='_'))
            throw new InvalidDataException("Invalid control archive ID");
        AtomicWrite(path+".control-"+controlId+".json",snapshot);
    }
}

// One writer, one in-flight snapshot and one cumulative pending snapshot. Events
// cannot be removed/uploaded before persistence, so coalescing pending saves
// retains every unacknowledged result. A cancel archive travels with its save.
public sealed class StateWriter : IDisposable
{
    sealed record Write(long Revision,DurableState State,string? ArchiveId,DurableState? Archive);
    readonly object gate=new();
    readonly IStateDisk disk;
    readonly Thread worker;
    readonly TaskCompletionSource<DurableState> loaded=new(TaskCreationOptions.RunContinuationsAsynchronously);
    Write? pending;
    long revision,persisted;
    bool stopping;
    string? error;
    public Task<DurableState> Loaded=>loaded.Task;
    public long Persisted=>Interlocked.Read(ref persisted);
    public string? Error=>Volatile.Read(ref error);
    public StateWriter(IStateDisk disk)
    {
        this.disk=disk;worker=new Thread(Run){IsBackground=true,Name="HYMM state writer"};worker.Start();
    }
    public long Submit(DurableState snapshot,string? archiveId=null,DurableState? archive=null)
    {
        lock(gate)
        {
            if(stopping)throw new ObjectDisposedException(nameof(StateWriter));
            if(archiveId!=null&&pending?.ArchiveId!=null)throw new InvalidOperationException("Control save already pending");
            pending=new(++revision,snapshot,archiveId??pending?.ArchiveId,archive??pending?.Archive);
            Monitor.PulseAll(gate);return revision;
        }
    }
    void Run()
    {
        try{loaded.SetResult(disk.Read());}
        catch(Exception e){Volatile.Write(ref error,"load_"+e.GetType().Name);loaded.SetException(e);return;}
        while(true)
        {
            Write? write;
            lock(gate){while(pending==null&&!stopping)Monitor.Wait(gate);write=pending;pending=null;if(write==null)return;}
            while(true)
            {
                try
                {
                    if(write.ArchiveId!=null)disk.Archive(write.ArchiveId,write.Archive!);
                    disk.Write(write.State);Interlocked.Exchange(ref persisted,write.Revision);Volatile.Write(ref error,null);break;
                }
                catch(Exception e)
                {
                    Volatile.Write(ref error,"save_"+e.GetType().Name);
                    lock(gate){if(stopping)return;Monitor.Wait(gate,1000);if(stopping)return;}
                }
            }
        }
    }
    public void Dispose()
    {
        lock(gate){stopping=true;Monitor.PulseAll(gate);}
        if(Thread.CurrentThread!=worker)worker.Join(2000);
    }
}
