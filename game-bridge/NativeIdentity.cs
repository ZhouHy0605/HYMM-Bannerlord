using System.Globalization;
using TaleWorlds.PlayerServices;

namespace ArenaBridge;

public static class NativeIdentity
{
    // Call only with the server peer's authenticated PlayerId. Bannerlord 1.4.8's
    // SteamPlayerIdExtensions.ToPlayerId creates (Steam, 0, steamId64); ToSteamId
    // reads Part4. Do not accept IDs from web requests or infer them from names.
    public static string? Resolve(PlayerId id,IReadOnlyDictionary<string,string> verifiedMappings)
    {
        verifiedMappings.TryGetValue(id.ToString(),out var mapped);
        if(id.ProvidedType!=PlayerIdProvidedTypes.Steam)
            return mapped!=null&&Policy.IsSteamId(mapped)?mapped:null;
        if(!id.IsValid||id.Part1!=(ulong)PlayerIdProvidedTypes.Steam||id.Part2!=0||id.Part3!=0)return null;
        var steam=id.Part4.ToString(CultureInfo.InvariantCulture);
        if(!Policy.IsSteamId(steam))return null;
        // A conflicting manual binding must fail closed, never impersonate another account.
        return mapped==null||mapped==steam?steam:null;
    }
}
