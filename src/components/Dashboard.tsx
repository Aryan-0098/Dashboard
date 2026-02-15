
"use client";

import { useState, useEffect } from "react";
import { db } from "@/lib/firebase";
import {
    collection,
    getDocs,
    doc,
    getDoc,
    query,
    limit,
    orderBy,
    where,
} from "firebase/firestore";
import { formatDuration, formatTimeAgo, cn, formatAppName } from "@/lib/utils";
import {
    Smartphone,
    Calendar as CalendarIcon,
    Unlock,
    Battery,
    Clock,
    History,
    Activity,
    Layers,
    ChevronDown,
    ChevronUp,
    Search,
    LayoutGrid,
    List as ListIcon
} from "lucide-react";

// Types
interface AppUsage {
    packageName: string;
    appName: string;
    usageTimeMs: number;
    lastTimeUsed: number;
    launchCount: number;
}

interface UsageStats {
    totalScreenTimeMs: number;
    appCount: number;
    apps: AppUsage[];
    timestamp: number;
}

interface DeviceStats {
    batteryLevel: number;
    isCharging: boolean;
    totalUnlocks: number;
    screenOnTimeMs: number;
    timestamp: number;
}

const COLORS = [
    "bg-blue-500",
    "bg-purple-500",
    "bg-amber-500",
    "bg-emerald-500",
    "bg-rose-500",
    "bg-cyan-500",
    "bg-indigo-500",
];

export default function Dashboard() {
    const [devices, setDevices] = useState<string[]>([]);
    const [selectedDevice, setSelectedDevice] = useState<string | null>(null);

    // Initial load of selected device
    useEffect(() => {
        const saved = localStorage.getItem("sanary_selected_device");
        if (saved) setSelectedDevice(saved);
    }, []);

    // Persist selected device
    useEffect(() => {
        if (selectedDevice) {
            localStorage.setItem("sanary_selected_device", selectedDevice);
        }
    }, [selectedDevice]);

    const [selectedDate, setSelectedDate] = useState(() => {
        return new Date().toISOString().split('T')[0];
    });

    const [usageStats, setUsageStats] = useState<UsageStats | null>(null);
    const [deviceStats, setDeviceStats] = useState<DeviceStats | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [debugInfo, setDebugInfo] = useState<string>("");
    const [viewMode, setViewMode] = useState<"list" | "grid">("list");
    const [searchQuery, setSearchQuery] = useState("");

    // Fetch Devices (and load from localStorage)
    useEffect(() => {
        async function fetchDevices() {
            try {
                const querySnapshot = await getDocs(collection(db, "sanary_monitor"));
                const fetchedIds = querySnapshot.docs.map((doc) => doc.id);

                // Merge with locally saved IDs
                const saved = localStorage.getItem("sanary_device_ids");
                const savedIds = saved ? JSON.parse(saved) : [];
                const uniqueIds = Array.from(new Set([...fetchedIds, ...savedIds])) as string[]; // Explicit cast

                setDevices(uniqueIds);
                if (uniqueIds.length > 0 && !localStorage.getItem("sanary_selected_device")) {
                    setSelectedDevice(uniqueIds[0]);
                }
            } catch (err: any) {
                console.error("Error fetching devices:", err);
                // Fallback to local
                const saved = localStorage.getItem("sanary_device_ids");
                if (saved) {
                    const ids = JSON.parse(saved) as string[];
                    setDevices(ids);
                    if (ids.length > 0 && !localStorage.getItem("sanary_selected_device")) setSelectedDevice(ids[0]);
                }
                // Show actual error
                setError(`Device Fetch Error: ${err.message || JSON.stringify(err)}`);
            }
        }
        fetchDevices();
    }, []);

    const handleAddDevice = (id: string) => {
        if (!id) return;
        const newDevices = [...devices, id];
        setDevices(newDevices);
        setSelectedDevice(id);
        localStorage.setItem("sanary_device_ids", JSON.stringify(newDevices));
        setSearchQuery(""); // Clear input if used there
    };

    // Fetch Data when Device/Date changes
    useEffect(() => {
        if (!selectedDevice || !selectedDate) return;

        async function fetchData() {
            setLoading(true);
            setError("");
            setUsageStats(null);
            setDeviceStats(null);

            try {
                // Fetch App Usage
                // We look for the LATEST synced data for the selected date
                // Path: sanary_monitor/{deviceId}/{date}/app_usage_{timestamp}

                // This is tricky. The valid collection path is `sanary_monitor/{deviceId}/{date}`.
                // We can't query a collection path that is dynamic like that easily if we don't know the exact date collection name logic?
                // Ah, `selectedDate` IS the collection name (e.g. "2024-05-20").
                // So we query collection(db, "sanary_monitor", selectedDevice, selectedDate)
                // AND we filter by document ID starting with "app_usage"? 
                // Firestore client SDK doesn't support "startsWith" on document ID efficiently in all cases.
                // BUT, we can just fetch all docs in that date collection (it usually has only ~3-10 docs per day: some app_usage, some events, some device snapshots).
                // It's cheaper to read the whole collection for the day.

                const getStartOfDay = (dateString: string) => {
                    if (!dateString) return 0;
                    const [y, m, d] = dateString.split('-').map(Number);
                    return new Date(y, m - 1, d).getTime();
                };

                // Fetch all docs for the date to find First and Last snapshots
                if (!selectedDevice) return;
                const dateCollectionRef = collection(db, "sanary_monitor", selectedDevice, selectedDate);
                const snapshot = await getDocs(dateCollectionRef);

                if (snapshot.empty) {
                    setLoading(false);
                    return;
                }

                // 1. Separate App Usage snapshots and Device snapshots
                const appUsageSnapshots: UsageStats[] = [];
                let latestDevice: DeviceStats | null = null;

                snapshot.forEach(doc => {
                    const data = doc.data();
                    if (doc.id.startsWith("app_usage_")) {
                        appUsageSnapshots.push(data as UsageStats);
                    } else if (doc.id.startsWith("device_")) {
                        if (!latestDevice || (data.timestamp > latestDevice.timestamp)) {
                            latestDevice = data as DeviceStats;
                        }
                    }
                });

                setDeviceStats(latestDevice);

                // 2. Sort usage snapshots by timestamp
                appUsageSnapshots.sort((a, b) => a.timestamp - b.timestamp);

                // Filter out snapshots with no apps (common on fresh install before permissions settle)
                const validSnapshots = appUsageSnapshots.filter(s => s.apps && s.apps.length > 0);

                if (validSnapshots.length === 0) {
                    setUsageStats(null);
                    setLoading(false);
                    return;
                }

                const earliest = validSnapshots[0];
                const latest = validSnapshots[validSnapshots.length - 1];

                // Calculate physical time window of monitoring
                const monitoringDuration = Math.max(0, latest.timestamp - earliest.timestamp);

                // Add buffer to monitoring duration (e.g. +1 min) to avoid strict cutoff floating point issues
                // Actually, if we missed the start of the minute, we might under-count. 
                // But generally, Usage CANNOT overlap Time. 
                // However, Android usage stats might have slightly different clock than System.currentTimeMillis. 
                // Let's be generous: maxPossible = duration * 1.1 + 5 minutes.
                // No, strict is better for the user's issue.
                const maxPossibleUsage = monitoringDuration + 60000; // +1 minute buffer

                // 3. Calculate Delta (Latest - Earliest)
                const processedApps = latest.apps.map(latestApp => {
                    // Find this app in the earliest snapshot from the SAME day
                    const earliersApp = earliest.apps.find(a => a.packageName === latestApp.packageName);

                    let usageDelta = latestApp.usageTimeMs;

                    if (earliersApp) {
                        const delta = latestApp.usageTimeMs - earliersApp.usageTimeMs;
                        // If delta is robustly positive, use it.
                        // If delta is negative (bucket reset), use latest.
                        if (delta >= 0) {
                            usageDelta = delta;
                        } else {
                            // Bucket reset: usage is just what's in latest
                            usageDelta = latestApp.usageTimeMs;
                        }
                    } else {
                        // App missing from baseline.
                        // If baseline was "late", this might be carried over data.
                        // CLAMP: Usage cannot exceed the time we've been watching.
                        // This fixes the "Install at 8pm -> 9h usage" bug.
                        // But wait, if usageDelta (latest) is 9h, and maxPossible is 15m.
                        // Result = 15m. Correct.
                    }

                    // Apply strict clamping
                    // "You cannot use an app for 2 hours in a 1 hour window"
                    // Exception: If monitoringDuration is 0 (first snapshot), maxPossible is 1m. Usage is clamped to 1m.
                    // This effectively zeros out pre-existing usage on the very first snapshot of a new install.
                    if (usageDelta > maxPossibleUsage) {
                        usageDelta = maxPossibleUsage;
                    }

                    return { ...latestApp, usageTimeMs: usageDelta };
                });

                // 4. Update State with processed apps
                setDebugInfo(`Base: ${new Date(earliest.timestamp).toLocaleTimeString()} (${earliest.apps.length} apps) -> End: ${new Date(latest.timestamp).toLocaleTimeString()}`);

                // We keep 'timestamp' from latest to show "Last Updated"
                setUsageStats({
                    ...latest,
                    apps: processedApps,
                    // Recalculate total screen time based on deltas
                    totalScreenTimeMs: processedApps.reduce((acc, app) => acc + app.usageTimeMs, 0)
                });

            } catch (err: any) {
                console.error("Error fetching data:", err);
                setError(`Data Fetch Error: ${err.code} - ${err.message}`);
            } finally {
                setLoading(false);
            }
        }

        fetchData();
    }, [selectedDevice, selectedDate]);

    // Derived state
    const totalScreenTime = usageStats?.totalScreenTimeMs || 0;

    // Sort and Filter based on processed stats
    const filteredApps = (usageStats?.apps || []).filter(app => {
        const displayName = formatAppName(app.packageName, app.appName);
        return displayName.toLowerCase().includes(searchQuery.toLowerCase()) ||
            app.appName.toLowerCase().includes(searchQuery.toLowerCase());
    }).sort((a, b) => b.usageTimeMs - a.usageTimeMs);

    const maxUsageTime = filteredApps.length > 0 ? filteredApps[0].usageTimeMs : 1;

    return (
        <div className="min-h-screen bg-zinc-950 text-zinc-100 p-4 md:p-8 font-sans selection:bg-rose-500/30">

            {/* Header */}
            <header className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4">
                <div>
                    <h1 className="text-3xl md:text-4xl font-bold bg-gradient-to-r from-rose-400 to-orange-400 bg-clip-text text-transparent">
                        Sanary Dashboard
                    </h1>
                    <p className="text-zinc-400 text-sm mt-1">Digital Wellbeing & Usage Monitor</p>
                </div>

                <div className="flex flex-wrap gap-3 items-center">
                    {/* Device Selector */}
                    <div className="relative group flex items-center gap-2">
                        <Smartphone className="absolute left-3 top-2.5 h-4 w-4 text-zinc-400" />
                        <select
                            value={selectedDevice}
                            onChange={(e) => setSelectedDevice(e.target.value)}
                            className="pl-9 pr-4 py-2 bg-zinc-900 border border-zinc-800 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-rose-500/50 appearance-none min-w-[160px]"
                        >
                            {devices.map(d => <option key={d} value={d}>{d.replace(/_/g, " ")}</option>)}
                            {devices.length === 0 && <option>No devices found</option>}
                        </select>

                        {/* Manual Add Trigger */}
                        <input
                            type="text"
                            placeholder="Add ID..."
                            className="w-24 px-2 py-2 bg-zinc-900 border border-zinc-800 rounded-xl text-xs focus:outline-none focus:border-rose-500"
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                    // Sanitize: match Android's Build.MODEL logic (spaces to underscores)
                                    const raw = (e.target as HTMLInputElement).value.trim();
                                    const sanitized = raw.replace(/ /g, "_").replace(/\//g, "-");
                                    handleAddDevice(sanitized);
                                    (e.target as HTMLInputElement).value = '';
                                }
                            }}
                        />
                    </div>

                    {/* Date Picker */}
                    <div className="relative">
                        <CalendarIcon className="absolute left-3 top-2.5 h-4 w-4 text-zinc-400" />
                        <input
                            type="date"
                            value={selectedDate}
                            onChange={(e) => setSelectedDate(e.target.value)}
                            className="pl-9 pr-4 py-2 bg-zinc-900 border border-zinc-800 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-rose-500/50 text-zinc-300"
                        />
                    </div>
                </div>
            </header>

            {/* Debug Path Info */}
            <div className="mb-4 px-2 text-[10px] text-zinc-600 font-mono">
                Querying: sanary_monitor/{selectedDevice}/{selectedDate}
            </div>

            {/* Main Content */}
            <main className="grid grid-cols-1 lg:grid-cols-3 gap-6">

                {/* Error Alert */}
                {error && (
                    <div className="lg:col-span-3 bg-red-500/10 border border-red-500/50 p-4 rounded-xl flex items-center gap-3 text-red-200">
                        <Activity className="h-5 w-5 text-red-400" />
                        <div>
                            <p className="font-bold text-sm">Connection Error</p>
                            <p className="text-xs">{error}</p>
                        </div>
                    </div>
                )}

                {/* Left Column: Stats & Overview */}
                <div className="space-y-6 lg:col-span-1">
                    {/* Hero Card: Screen Time */}
                    <div className="p-6 rounded-3xl bg-zinc-900/50 border border-zinc-800 relative overflow-hidden">
                        <div className="absolute top-0 right-0 p-4 opacity-10">
                            <Clock className="w-32 h-32" />
                        </div>

                        <h2 className="text-zinc-400 text-sm font-medium mb-1">Total Screen Time</h2>
                        <div className="text-5xl font-bold tracking-tight text-white mb-2">
                            {formatDuration(totalScreenTime)}
                        </div>
                        <div className="flex items-center gap-2 text-xs text-zinc-500">
                            <Activity className="w-3 h-3" />
                            <span>Updated {usageStats ? formatTimeAgo(usageStats.timestamp) : "Never"}</span>
                        </div>
                    </div>

                    {/* Stats Grid */}
                    <div className="grid grid-cols-2 gap-4">
                        {/* Unlocks */}
                        <div className="p-4 rounded-2xl bg-zinc-900/50 border border-zinc-800">
                            <div className="flex items-center gap-2 mb-2 text-zinc-400">
                                <Unlock className="w-4 h-4" />
                                <span className="text-xs font-medium">Unlocks</span>
                            </div>
                            <div className="text-2xl font-bold">{deviceStats?.totalUnlocks || 0}</div>
                        </div>

                        {/* Battery */}
                        <div className="p-4 rounded-2xl bg-zinc-900/50 border border-zinc-800">
                            <div className="flex items-center gap-2 mb-2 text-zinc-400">
                                <Battery className="w-4 h-4" />
                                <span className="text-xs font-medium">Battery</span>
                            </div>
                            <div className="flex items-baseline gap-1">
                                <div className="text-2xl font-bold">
                                    {(() => {
                                        const level = deviceStats?.batteryLevel || 0;
                                        // Handle both 0-1 (float) and 0-100 (int) formats
                                        return level > 1 ? Math.round(level) : Math.round(level * 100);
                                    })()}%
                                </div>
                                {deviceStats?.isCharging && <span className="text-[10px] text-green-400">⚡ Charging</span>}
                            </div>
                        </div>
                    </div>

                    {/* Quick Info */}
                    <div className="p-6 rounded-3xl bg-gradient-to-br from-indigo-900/20 to-purple-900/20 border border-indigo-500/10">
                        <h3 className="font-semibold text-indigo-300 mb-2">Did you know?</h3>
                        <p className="text-sm text-indigo-400/80 leading-relaxed">
                            You've unlocked your phone {deviceStats?.totalUnlocks || 0} times today.
                            That's an average of once every {deviceStats?.totalUnlocks ? Math.round((totalScreenTime / 60000) / deviceStats.totalUnlocks) : 0} minutes of use.
                        </p>
                    </div>
                </div>

                {/* Right Column: App Usage List */}
                <div className="lg:col-span-2 space-y-4">
                    {/* Section Header */}
                    <div className="flex justify-between items-center px-2">
                        <h2 className="text-xl font-semibold flex items-center gap-2">
                            <Layers className="w-5 h-5 text-rose-500" />
                            App Usage
                        </h2>

                        <div className="flex items-center gap-4">
                            <span className="text-[10px] text-zinc-700 font-mono">{debugInfo}</span>
                            {usageStats && (
                                <div className="hidden md:block text-[10px] text-zinc-600 font-mono">
                                    Delta: {new Date(usageStats.timestamp).getHours()}:{new Date(usageStats.timestamp).getMinutes()}
                                    (Base: {new Date(usageStats.apps[0]?.lastTimeUsed || 0).getHours()}:00)
                                </div>
                            )}
                            <div className="relative">
                                <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-zinc-500" />
                                <input
                                    type="text"
                                    placeholder="Filter apps..."
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    className="pl-8 pr-3 py-1.5 bg-zinc-900 border border-zinc-800 rounded-lg text-xs focus:outline-none focus:border-zinc-700 w-32 transition-all focus:w-48"
                                />
                            </div>
                            <div className="flex bg-zinc-900 rounded-lg p-1 border border-zinc-800">
                                <button
                                    onClick={() => setViewMode("list")}
                                    className={cn("p-1.5 rounded-md transition-all", viewMode === "list" ? "bg-zinc-800 text-white" : "text-zinc-500 hover:text-zinc-300")}
                                >
                                    <ListIcon className="w-3.5 h-3.5" />
                                </button>
                                <button
                                    onClick={() => setViewMode("grid")}
                                    className={cn("p-1.5 rounded-md transition-all", viewMode === "grid" ? "bg-zinc-800 text-white" : "text-zinc-500 hover:text-zinc-300")}
                                >
                                    <LayoutGrid className="w-3.5 h-3.5" />
                                </button>
                            </div>
                        </div>
                    </div>

                    {/* List Content */}
                    {loading ? (
                        <div className="flex justify-center py-20">
                            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-rose-500"></div>
                        </div>
                    ) : filteredApps.length === 0 ? (
                        <div className="text-center py-20 text-zinc-500 bg-zinc-900/20 rounded-3xl border border-zinc-800/50 border-dashed">
                            <p>No usage data found for this date.</p>
                        </div>
                    ) : (
                        <div className={cn(
                            "gap-3",
                            viewMode === "grid" ? "grid grid-cols-1 sm:grid-cols-2" : "flex flex-col"
                        )}>
                            {filteredApps.map((app, idx) => (
                                <div key={app.packageName} className="group relative bg-zinc-900/40 hover:bg-zinc-900/80 border border-zinc-800 hover:border-zinc-700 p-4 rounded-2xl transition-all duration-300">
                                    {/* Progress Background (List mode only) */}
                                    {viewMode === "list" && (
                                        <div
                                            className="absolute left-0 top-0 bottom-0 bg-rose-500/5 rounded-l-2xl transition-all duration-500"
                                            style={{ width: `${(app.usageTimeMs / maxUsageTime) * 100}%` }}
                                        />
                                    )}

                                    <div className="relative flex justify-between items-center z-10">
                                        <div className="flex items-center gap-4">
                                            <div className={cn(
                                                "w-10 h-10 rounded-xl flex items-center justify-center font-bold text-sm shadow-inner",
                                                COLORS[idx % COLORS.length]
                                            )}>
                                                {formatAppName(app.packageName, app.appName).charAt(0).toUpperCase()}
                                            </div>
                                            <div>
                                                <h3 className="font-medium text-zinc-200">{formatAppName(app.packageName, app.appName)}</h3>
                                                <p className="text-xs text-zinc-500">
                                                    {app.launchCount} opens • Last used {formatTimeAgo(app.lastTimeUsed)}
                                                </p>
                                            </div>
                                        </div>
                                        <div className="text-right">
                                            <div className="font-bold text-zinc-200">{formatDuration(app.usageTimeMs)}</div>
                                            <div className="text-[10px] text-zinc-500">
                                                {totalScreenTime > 0 ? Math.round((app.usageTimeMs / totalScreenTime) * 100) : 0}%
                                            </div>
                                        </div>
                                    </div>

                                    {/* Grid mode bar */}
                                    {viewMode === "grid" && (
                                        <div className="mt-4 h-1.5 w-full bg-zinc-800 rounded-full overflow-hidden">
                                            <div
                                                className={cn("h-full rounded-full", COLORS[idx % COLORS.length])}
                                                style={{ width: `${(app.usageTimeMs / maxUsageTime) * 100}%` }}
                                            />
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </main>
        </div>
    );
}
