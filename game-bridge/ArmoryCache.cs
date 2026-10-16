using System.Security.Cryptography;
using System.Text.Json;

namespace ArenaBridge;

// Accessed only on the game thread. Unchanged profiles keep their object identity,
// so connections can skip both serialization and rebuilding native selections.
public sealed class ArmoryCache
{
    public Dictionary<string,Dictionary<string,string[]>> Profiles {get;}=new();
    readonly Dictionary<string,string> versions=new();
    public Dictionary<string,string> Known(string[] ids)=>ids.Where(versions.ContainsKey).ToDictionary(id=>id,id=>versions[id]);
    public void Apply(ArmoryReply reply)
    {
        foreach(var (id,version) in reply.Versions)
            if((!versions.TryGetValue(id,out var old)||old!=version)&&!reply.Profiles.ContainsKey(id))
                throw new InvalidDataException("Changed armory version without profile");
        foreach(var id in reply.Profiles.Keys)
            if(!reply.Versions.ContainsKey(id))throw new InvalidDataException("Armory profile without version");
        foreach(var (id,profile) in reply.Profiles)
        {
            var version=reply.Versions[id];
            if(!versions.TryGetValue(id,out var old)||old!=version)Profiles[id]=profile;
        }
        foreach(var (id,version) in reply.Versions)versions[id]=version;
    }
    public void Retain(string[] ids)
    {
        var keep=ids.ToHashSet();
        foreach(var id in Profiles.Keys.Where(id=>!keep.Contains(id)).ToArray()){Profiles.Remove(id);versions.Remove(id);}
    }
    // Older websites return full profiles. Hash off the game thread to retain
    // compatibility without repeatedly applying identical selections.
    public static ArmoryReply Normalize(ArmoryReply reply)
    {
        foreach(var (id,profile) in reply.Profiles)
            if(!reply.Versions.ContainsKey(id))reply.Versions[id]=Convert.ToHexString(SHA256.HashData(JsonSerializer.SerializeToUtf8Bytes(profile)));
        return reply;
    }
}
