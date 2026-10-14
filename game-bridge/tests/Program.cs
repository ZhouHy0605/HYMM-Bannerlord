using ArenaBridge;
using System.Text.Json;

void Check(bool v,string message){if(!v)throw new Exception(message);}
PreparationChecks.Run();
HalftimeChecks.Run();
KillStreakChecks.Run();
// Disconnect counters survive removal from the online collection; reconnecting
// with the native retained peer does not duplicate totals. Offline rounds count.
var offlineLedger=new CombatLedger(new[]{"one","two"});
var retainedPeer=new object();var replacementPeer=new object();
offlineLedger.BeginRound();offlineLedger.Observe("one",retainedPeer,5,2,3,true);
offlineLedger.Observe("one",retainedPeer,7,3,4);
offlineLedger.Observe("one",retainedPeer,7,3,4); // Reconnect, same native peer.
offlineLedger.Observe("one",replacementPeer,1,0,1); // Explicit quit, fresh peer.
offlineLedger.EndRound();
Check(offlineLedger.Players["one"].Kills==3&&offlineLedger.Players["one"].Deaths==1&&offlineLedger.Players["one"].Assists==2,"offline/reconnect totals, no duplicate counters");
offlineLedger.BeginRound();offlineLedger.Observe("one",retainedPeer,7,3,4,true);offlineLedger.Observe("one",replacementPeer,1,0,1,true);offlineLedger.EndRound();
Check(offlineLedger.Players.Values.All(p=>p.Rounds==2)&&offlineLedger.Players["two"].Spawns==0,"absent players retain actual zero activity and full round denominator");
Check(offlineLedger.Players["one"].Kills==3,"offline second round does not duplicate old kills");
var scoreLedger=new CombatLedger(new[]{"one"});var scorePeer=new object();var rejoinPeer=new object();
scoreLedger.BeginRound();scoreLedger.Observe("one",scorePeer,0,0,0,true,100);
scoreLedger.Observe("one",scorePeer,0,0,0,false,135);
scoreLedger.Observe("one",scorePeer,0,0,0,false,120);
scoreLedger.Observe("one",scorePeer,0,0,0,false,120);
scoreLedger.Observe("one",rejoinPeer,0,0,0,false,7);
Check(scoreLedger.Players["one"].NativeScore==27,"native score excludes warmup, preserves deductions and fresh-peer score without double counting");
scoreLedger.EndRound();scoreLedger.BeginRound();scoreLedger.Observe("one",scorePeer,0,0,0,true,120);
scoreLedger.Observe("one",rejoinPeer,0,0,0,true,7);scoreLedger.Observe("one",scorePeer,0,0,0,false,130);
Check(scoreLedger.Players["one"].NativeScore==37,"new round baseline does not duplicate retained native score");
var nextHalf=new CombatLedger(new[]{"one"});nextHalf.BeginRound();nextHalf.Observe("one",scorePeer,0,0,0,true,130);nextHalf.Observe("one",scorePeer,0,0,0,false,160);
Check(nextHalf.Players["one"].NativeScore==30,"halftime retains scoreboard but reports only second-half native score increment");
// Mirror native PostRoundEnd: total played cap OR a side > total/2.
void CheckRound(int played,int a,int b,bool shouldEnd){int total=Policy.RoundLimit(played,a,b);Check((played==total||a>total/2||b>total/2)==shouldEnd,$"first-to-three: {played} rounds, {a}:{b}");}
CheckRound(3,3,0,true);CheckRound(4,3,1,true);CheckRound(5,3,2,true);
CheckRound(4,2,2,false);CheckRound(5,2,2,false);CheckRound(6,2,2,false);
CheckRound(6,3,2,true);CheckRound(8,2,3,true);CheckRound(20,0,0,false);
CheckRound(99,3,2,true);
foreach(var played in new[]{3,4,5,6,10}){int limit=Policy.RoundLimit(played,3,Math.Min(2,played-3),true);Check(played<limit&&3<=limit/2,"first half reaching three wins must not end the native mission");}
try{Policy.RoundLimit(99,2,2);throw new Exception("missing safety limit");}catch(Exception e)when(e.Message=="round_safety_limit"){}
var spawnCounter=new CombatSpawns();var troop=new CombatPlayer();var life=new object();
spawnCounter.Observe(life,troop,false,false);spawnCounter.Observe(life,troop,false,false);
Check(troop.Spawns==1&&troop.Classes.Infantry==1,"repeated callbacks cannot duplicate spawn");
spawnCounter.Observe(life,troop,true,true);spawnCounter.Observe(life,troop,false,false);
Check(troop.Spawns==1&&troop.Classes.Infantry==0&&troop.Classes.Cavalry==1,"mount promotion and dismount preserve cavalry life, including horse archers");
spawnCounter.Observe(new object(),troop,false,true);
Check(troop.Spawns==2&&troop.Classes.Archer==1,"new archer life after respawn");
spawnCounter.BeginRound();spawnCounter.Observe(new object(),troop,false,false);
Check(troop.Spawns==3&&troop.Classes.Infantry==1&&troop.Classes.Cavalry==1,"round reset preserves match class totals");
var nativeSteam=new TaleWorlds.PlayerServices.PlayerId((byte)TaleWorlds.PlayerServices.PlayerIdProvidedTypes.Steam,0,76561198000000000UL);
var bindings=new Dictionary<string,string>();
Check(NativeIdentity.Resolve(nativeSteam,bindings)=="76561198000000000","authenticated native Steam account resolves without manual mapping");
Check(NativeIdentity.Resolve(new TaleWorlds.PlayerServices.PlayerId((byte)TaleWorlds.PlayerServices.PlayerIdProvidedTypes.Epic,0,nativeSteam.Part4),bindings)==null,"non-Steam IDs cannot borrow a Steam-shaped suffix");
Check(NativeIdentity.Resolve(new TaleWorlds.PlayerServices.PlayerId((byte)TaleWorlds.PlayerServices.PlayerIdProvidedTypes.Forced,0,nativeSteam.Part4),bindings)==null,"forced IDs remain unverified");
Check(NativeIdentity.Resolve(new TaleWorlds.PlayerServices.PlayerId(2,1,nativeSteam.Part4),bindings)==null,"unexpected native layout rejected");
Check(NativeIdentity.Resolve(new TaleWorlds.PlayerServices.PlayerId(2,0,123UL),bindings)==null,"invalid Steam ID rejected");
bindings[nativeSteam.ToString()]="76561198000000001";
Check(NativeIdentity.Resolve(nativeSteam,bindings)==null,"conflicting manual identity fails closed");
bindings[nativeSteam.ToString()]="76561198000000000";
Check(NativeIdentity.Resolve(nativeSteam,bindings)==bindings[nativeSteam.ToString()],"verified matching identity preserved");
var teams=Enumerable.Range(0,12).Select(i=>(76561198000000000L+i).ToString()).Chunk(6).ToArray();
var fixture=new Job{MatchId="test-match",Map="test-map",Mode="Skirmish",RoundsToWin=3,Teams=teams,Cultures=new[]{"vlandia","empire"}};
Check(Policy.Valid(fixture,"test-map"),"valid roster");
Check(!Policy.Valid(fixture,"wrong-map"),"wrong map");
fixture.Cultures=new[]{"empire","empire"};Check(!Policy.Valid(fixture,"test-map"),"mirror cultures rejected");fixture.Cultures=new[]{"vlandia","empire"};
Check(Policy.Team(fixture,teams[0][1])==0 && Policy.Team(fixture,teams[1][0])==1,"team assignment");
Check(Policy.Team(fixture,null)==-1 && Policy.Team(fixture,"unknown")==-1,"outsider spectator");
fixture.Format="two-leg-v1";var second=Policy.SecondLeg(fixture);
Check(fixture.Leg==0&&second.Leg==1&&second.MatchId==fixture.MatchId&&second.Map==fixture.Map,"same match/map; original event job stays leg zero");
Check(second.Cultures.SequenceEqual(fixture.Cultures)&&second.Teams[0].SequenceEqual(teams[0]),"physical cultures and original A/B identities retained");
Check(teams.SelectMany(t=>t).All(id=>Policy.SelectionSide(second,id,true)==1-Policy.Team(fixture,id)),"all 12 admitted players swap sides in place");
Check(Policy.SelectionSide(second,"unknown",false)==-1,"outsider stays spectator");
try{Policy.SecondLeg(second);throw new Exception("duplicated switch");}catch(Exception e)when(e.Message=="invalid_second_leg_transition"){}
fixture.Format="single-v1";fixture.Leg=0;
Check(Policy.SelectionSide(null,teams[0][0],true,true)==-1,"idle server rejects both auto and previous admission");
Check(Policy.SelectionSide(fixture,teams[0][0],false)==-1,"manual selection cannot admit a roster player");
Check(Policy.SelectionSide(fixture,teams[0][0],false,true)==0,"auto selection admits A to attackers");
Check(Policy.SelectionSide(fixture,teams[1][0],false,true)==1,"auto selection admits B to defenders");
Check(Policy.SelectionSide(fixture,"unknown",true,true)==-1&&Policy.SelectionSide(fixture,null,false,true)==-1,"outsiders and unmapped players remain spectators");
Check(Policy.SelectionSide(fixture,teams[0][0],true)==0,"manual selection preserves the assigned side");
Check(Policy.SelectionSide(fixture,teams[0][0],true,false,true)==-1,"spectator request withdraws admission");
fixture.Format="two-leg-v1";fixture.Leg=1;
Check(Policy.Side(fixture,teams[0][1])==1&&Policy.Side(fixture,teams[1][0])==0,"second leg swaps sides");
Check(Policy.SelectionSide(fixture,teams[0][0],false,true)==1&&Policy.SelectionSide(fixture,teams[1][0],false,true)==0,"second-leg auto selection uses swapped roster sides");
Check(Policy.SelectionSide(fixture,teams[0][0],false)==-1,"new mission or reconnect requires auto selection again");
Check(Policy.OriginalScore(fixture,3,1).SequenceEqual(new[]{1,3}),"second-leg scoreboard maps to original A/B");
fixture.Format="single-v1";fixture.Leg=0;
Check(Policy.FinalScore(3,2)&&Policy.FinalScore(0,3)&&!Policy.FinalScore(3,3)&&!Policy.FinalScore(2,1),"score policy");
fixture.Teams[1][0]=fixture.Teams[0][0];Check(!Policy.Valid(fixture,"test-map"),"duplicate player rejected");
if(args.Length==0){Console.WriteLine("Policy checks passed");return;}
var cfg=new Config{BaseUrl=args[0],Token=args[1],ServerId="test-game-1"};
var statePath=args[2];
using(var link=new Transport(cfg,statePath,Console.WriteLine))
{
    var job=await link.Claim(args[3]);Check(job!=null,"HTTP claim");link.State.Active=job;link.Save();
    string start=link.Queue("started",job!);
    for(int i=0;i<100&&link.Pending(start);i++){link.Tick();await Task.Delay(30);}
    Check(!link.Pending(start)&&link.State.Blocked==null,"start acknowledged");
    var combat=new CombatReport{Version=2,DrawRounds=1,Players=job!.Teams.SelectMany(t=>t).Select(id=>new CombatPlayer{Id=id,Kills=5,Deaths=2,Assists=3,Damage=480,Rounds=6,Spawns=6,HorseDamage=120,Classes=new CombatClasses{Cavalry=6}}).ToArray()};
    var next=link.BeginSecondLeg(job!,new[]{3,2},combat);
    var started=link.Queue("started",next);
    Check(link.State.Outbox.Count==2&&link.State.Outbox[0].Leg==0&&link.State.Outbox[1].Leg==1,"first result precedes second start without a second claim");
    for(int i=0;i<100&&link.Pending(started);i++){link.Tick();Check(link.State.Active?.Leg==1,"old result acknowledgement cannot erase second-leg ownership");await Task.Delay(30);}
    Check(!link.Pending(started)&&link.State.Blocked==null,"in-place second leg authorized");
    var report=new CombatReport{Version=2,Players=next.Teams.SelectMany(t=>t).Select(id=>new CombatPlayer{Id=id,Kills=5,Deaths=2,Assists=3,Damage=480,Rounds=4,Spawns=4,HorseDamage=120,Classes=new CombatClasses{Infantry=4}}).ToArray()};
    link.Queue("finished",next,Policy.OriginalScore(next,3,1),combat:report);link.Queue("finished",next,Policy.OriginalScore(next,3,1),combat:report);
    Check(link.State.Outbox.Count==1,"deduplicate queued final result");
}
// Restart transport with a persisted result that was never sent.
using(var restarted=new Transport(cfg,statePath,Console.WriteLine))
{
    Check(restarted.State.Outbox.Count==1 && restarted.State.Outbox[0].Type=="finished","durable result preserved");
    for(int i=0;i<100&&restarted.State.Outbox.Count>0;i++){restarted.Tick();await Task.Delay(30);}
    Check(restarted.State.Active==null&&restarted.State.Outbox.Count==0&&restarted.State.Blocked==null,"result acknowledged after restart");
}
var interruptedHalf=new DurableState{Active=second,Outbox=new(){new BridgeEvent{Type="finished",MatchId=second.MatchId,Leg=0,EventId="first-finished"}}};
File.WriteAllText(statePath,JsonSerializer.Serialize(interruptedHalf,Transport.Json));
using(var restarted=new Transport(cfg,statePath,Console.WriteLine))
    Check(restarted.State.Outbox.Count==2&&restarted.State.Outbox[1].Type=="failed"&&restarted.State.Outbox[1].Leg==1,"restart during halftime retains first result and marks second leg for review");
var interrupted=new DurableState{Active=new Job{MatchId="interrupted"}};
File.WriteAllText(statePath,JsonSerializer.Serialize(interrupted,Transport.Json));
using(var restarted=new Transport(cfg,statePath,Console.WriteLine))
    Check(restarted.State.Outbox.Single().Type=="failed","interrupted mission goes to review");
Console.WriteLine("Bridge policy, real HTTP, durable replay and recovery checks passed");
