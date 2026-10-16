using ArenaBridge;
using System.Collections.Concurrent;
using System.Diagnostics;

static class OptimizationChecks
{
    static void Check(bool value,string message){if(!value)throw new Exception(message);}
    public static void Run()
    {
        var cache=new ArmoryCache();
        var profile=new Dictionary<string,string[]>{{"class",new[]{"hat"}}};
        cache.Apply(new(){Profiles=new(){{"one",profile}},Versions=new(){{"one","v1"}}});
        cache.Apply(new(){Versions=new(){{"one","v1"}}});
        cache.Apply(new(){Profiles=new(){{"one",new()}},Versions=new(){{"one","v1"}}});
        Check(ReferenceEquals(cache.Profiles["one"],profile),"unchanged versions keep reference and native selection");
        try{cache.Apply(new(){Profiles=new(){{"one",new()}},Versions=new(){{"one","v2"},{"two","missing"}}});throw new Exception("invalid delta accepted");}catch(InvalidDataException){}
        Check(ReferenceEquals(cache.Profiles["one"],profile)&&cache.Known(new[]{"one"})["one"]=="v1","invalid delta cannot partly modify cache");
        cache.Apply(new(){Profiles=new(){{"one",new()}},Versions=new(){{"one","reset"}}});
        Check(cache.Profiles["one"].Count==0,"empty reset is applied, not treated as missing update");
        cache.Retain(Array.Empty<string>());Check(cache.Known(new[]{"one"}).Count==0&&cache.Profiles.Count==0,"departure releases profile and version");
        var legacy=ArmoryCache.Normalize(new(){Profiles=new(){{"one",profile}}});cache.Apply(legacy);
        Check(legacy.Versions["one"]==ArmoryCache.Normalize(new(){Profiles=new(){{"one",profile}}}).Versions["one"],"legacy server hash stable");
        var batches=new ConcurrentQueue<string>();
        using(var log=new BufferedDiagnosticLog(batches.Enqueue)){log.Write("same");for(int i=0;i<100;i++)log.Write("same");log.Write("next");}
        var text=string.Concat(batches);Check(text.Contains("repeated 100 times")&&text.Contains("next"),"duplicates summarized and shutdown flushes");
        using var entered=new ManualResetEventSlim();using var release=new ManualResetEventSlim();
        var blocked=new BufferedDiagnosticLog(t=>{entered.Set();release.Wait();batches.Enqueue(t);},8);
        try{
            blocked.Write("block");Check(entered.Wait(3000),"background sink starts");
            var watch=Stopwatch.StartNew();for(int i=0;i<10000;i++)blocked.Write("burst "+i);
            Check(watch.ElapsedMilliseconds<1000,"blocked sink does not block producer");
        }finally{release.Set();blocked.Dispose();}
        Check(string.Concat(batches).Contains("Diagnostics omitted"),"overflow bounded and reported");
        int attempts=0;using(var log=new BufferedDiagnosticLog(_=>{Interlocked.Increment(ref attempts);throw new IOException();})){log.Write("disk unavailable");}
        Check(attempts==1,"sink failure cannot escape or retry without bound");
        Console.WriteLine("Optimization cache/log checks passed");
    }
}
