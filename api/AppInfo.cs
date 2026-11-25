using System.Reflection;

namespace Cloudheat.Api;

public static class AppInfo
{
    /// <summary>"0.1.0+a1b2c3d" — 배포 스크립트가 /p:Version 으로 넣고, .NET SDK 가 Git 커밋을 붙임</summary>
    public static readonly string Version = Short(
        typeof(AppInfo).Assembly.GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion ?? "dev");

    private static string Short(string v)
    {
        var i = v.IndexOf('+');
        return i < 0 || v.Length <= i + 8 ? v : v[..(i + 8)];
    }
}
