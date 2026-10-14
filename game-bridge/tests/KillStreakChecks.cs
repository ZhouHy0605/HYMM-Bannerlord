using ArenaBridge;
internal static class KillStreakChecks
{
    public static void Run()
    {
        void Check(bool value,string message){if(!value)throw new Exception(message);}
        var s=new KillStreaks();var a=new object();
        Check(s.Removed(new object(),a,true,0)==0,"one kill is silent");
        Check(s.Removed(new object(),a,true,14)==0,"second kill is silent");
        Check(s.Removed(new object(),a,true,28)==3,"each kill refreshes the 15s window");
        var victim=new object();
        Check(s.Removed(victim,a,true,42)==4,"fourth kill");
        Check(s.Removed(victim,a,true,50)==0,"duplicate removal does not count or refresh");
        Check(s.Removed(new object(),a,true,56)==5,"fifth kill refreshes again");
        Check(s.Removed(new object(),a,true,71)==0,"exact expiry starts at one");
        s.Removed(new object(),a,true,72);
        s.Removed(new object(),a,false,86); // Friendly/environment/cleanup must not refresh.
        Check(s.Removed(new object(),a,true,87)==0,"invalid kill cannot extend window");
        s.Removed(a,null,false,88);
        Check(s.Removed(new object(),a,true,89)==0,"dead attacker cannot start a delayed streak");
        var respawn=new object();s.Removed(new object(),respawn,true,90);s.Removed(new object(),respawn,true,91);
        Check(s.Removed(new object(),respawn,true,92)==3,"fresh life works");
        s.Forget(respawn);Check(s.Removed(new object(),respawn,true,93)==0,"team change resets");
        s.Reset();Check(s.Removed(new object(),respawn,true,94)==0,"round/halftime resets");
        Check(s.Removed(respawn,respawn,true,95)==0,"suicide never awards");
        Console.WriteLine("Timed killstreak checks passed");
    }
}
