
import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs));
}

export function formatDuration(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) {
        const remainingMinutes = minutes % 60;
        return `${hours}h ${remainingMinutes}m`;
    }
    return `${minutes}m`;
}

export function formatTimeAgo(timestamp: number): string {
    const diff = Date.now() - timestamp;
    const minutes = Math.floor(diff / 60000);

    if (minutes < 1) return "Just now";
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    return new Date(timestamp).toLocaleDateString();
}

export const commonPackages: Record<string, string> = {
    "com.whatsapp": "WhatsApp",
    "com.instagram.android": "Instagram",
    "com.google.android.youtube": "YouTube",
    "com.snapchat.android": "Snapchat",
    "com.facebook.katana": "Facebook",
    "com.twitter.android": "X / Twitter",
    "com.linkedin.android": "LinkedIn",
    "com.google.android.gm": "Gmail",
    "com.google.android.apps.maps": "Maps",
    "com.spotify.music": "Spotify",
    "com.netflix.mediaclient": "Netflix",
    "com.google.android.chrome": "Chrome",
    "com.android.chrome": "Chrome",
    "com.google.android.googlequicksearchbox": "Google",
    "com.google.android.calendar": "Calendar",
    "com.microsoft.teams": "Teams",
    "com.zhiliaoapp.musically": "TikTok",
    "com.discord": "Discord",
    "org.telegram.messenger": "Telegram",
    "com.aryan.sanary": "Sanary",
};

export function formatAppName(packageName: string, appNameFromData?: string): string {
    // If the app name from data is already good and not empty, use it.
    if (appNameFromData && !appNameFromData.includes(".") && appNameFromData !== packageName && appNameFromData.trim().length > 0) {
        return appNameFromData;
    }

    if (commonPackages[packageName]) {
        return commonPackages[packageName];
    }

    // Fallback: extract last segment and capitalize
    const parts = packageName.split('.');
    let name = parts[parts.length - 1];

    // Cleanup common suffixes like 'android', 'mobile' if they are the last part
    if ((name === 'android' || name === 'mobile') && parts.length > 1) {
        name = parts[parts.length - 2];
    }

    return name.charAt(0).toUpperCase() + name.slice(1);
}
