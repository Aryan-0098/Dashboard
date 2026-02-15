"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { db } from "@/lib/firebase";
import { collection, onSnapshot, query, where, getDocs } from "firebase/firestore";
import { formatDuration, formatTimeAgo, cn, formatAppName } from "@/lib/utils";
import {
    ArrowLeft,
    Calendar,
    Smartphone,
    Activity,
    Filter,
    CheckCircle2
} from "lucide-react";

// Types
interface UsageEvent {
    packageName: string;
    appName: string;
    eventType: "APP_OPENED" | "APP_CLOSED" | "UNKNOWN";
    timestamp: number;
    time: string;
}

interface AppSession {
    startTime: number;
    endTime: number | null; // null means currently active or crash
    durationMs: number;
    isOngoing: boolean;
}

export default function AppDetailsPage() {
    const params = useParams();
    const router = useRouter();
    // Next.js App Router params are automatically available
    const { deviceId, date, packageName: rawPackageName } = params as { deviceId: string, date: string, packageName: string };
    const packageName = decodeURIComponent(rawPackageName);

    const [sessions, setSessions] = useState<AppSession[]>([]);
    const [loading, setLoading] = useState(true);
    const [stats, setStats] = useState({
        totalDuration: 0,
        sessionCount: 0,
        avgSessionDuration: 0,
        appName: packageName
    });

    useEffect(() => {
        if (!deviceId || !date || !packageName) return;

        setLoading(true);
        // We query the date collection.
        // The events are in documents named events_{timestamp}.
        // We have to fetch all and filter client side because Firestore collection structure 
        // here puts events inside a document array, not as individual documents.
        const dateCollectionRef = collection(db, "sanary_monitor", deviceId, date);

        const unsubscribe = onSnapshot(dateCollectionRef, (snapshot) => {
            const allEvents: UsageEvent[] = [];

            snapshot.forEach(doc => {
                if (doc.id.startsWith("events_")) {
                    const data = doc.data();
                    if (data.events && Array.isArray(data.events)) {
                        // Cast for safety
                        const events = data.events.map((e: any) => ({
                            packageName: e.packageName,
                            appName: e.appName,
                            // Map numeric types if stored as such, or string types
                            eventType: e.eventType === "APP_OPENED" || e.eventType === "APP_CLOSED" ? e.eventType : "UNKNOWN",
                            timestamp: e.timestamp,
                            time: e.time
                        }));
                        allEvents.push(...events);
                    }
                }
            });

            // 1. Filter for target app & Sort
            const appEvents = allEvents
                .filter(e => e.packageName === packageName)
                .sort((a, b) => a.timestamp - b.timestamp);

            if (appEvents.length > 0) {
                setStats(prev => ({ ...prev, appName: appEvents[0].appName }));
            }

            // 2. Reconstruct Sessions
            const reconstructedSessions: AppSession[] = [];
            let currentStart: UsageEvent | null = null;
            const now = Date.now();
            const isToday = new Date().toISOString().split('T')[0] === date;

            for (const event of appEvents) {
                if (event.eventType === "APP_OPENED") {
                    if (currentStart) {
                        // Previous session wasn't closed. Assume it ended just now (at new start).
                        reconstructedSessions.push({
                            startTime: currentStart.timestamp,
                            endTime: event.timestamp,
                            durationMs: event.timestamp - currentStart.timestamp,
                            isOngoing: false
                        });
                    }
                    currentStart = event;
                } else if (event.eventType === "APP_CLOSED") {
                    if (currentStart) {
                        reconstructedSessions.push({
                            startTime: currentStart.timestamp,
                            endTime: event.timestamp,
                            durationMs: event.timestamp - currentStart.timestamp,
                            isOngoing: false
                        });
                        currentStart = null;
                    }
                    // Else: Dangling End. Ignore.
                }
            }

            // Handle ongoing session (last event was OPEN)
            if (currentStart) {
                // If it's today and reasonably recent (< 12 hours?), mark as ongoing/active
                // If date allows it to be active
                const timeDiff = now - currentStart.timestamp;
                // If it opened 2 days ago, it's definitely not "Active" in a meaningful sense for *this* timeline unless app is persistent.
                // But let's trust the data.

                if (isToday) {
                    reconstructedSessions.push({
                        startTime: currentStart.timestamp,
                        endTime: null,
                        durationMs: timeDiff,
                        isOngoing: true
                    });
                } else {
                    // For past days, open w/o close means crash/kill.
                    // Cap at some reasonable time? or show "Unknown End"
                    // Let's cap at 1 hour for display if unknown
                    reconstructedSessions.push({
                        startTime: currentStart.timestamp,
                        endTime: currentStart.timestamp + 3600000,
                        durationMs: 3600000,
                        isOngoing: false
                    });
                }
            }

            // 3. Filter Noise (< 60s)
            // User requested "no useless background processes"
            const meaningfulSessions = reconstructedSessions.filter(s => s.durationMs > 60000); // > 1 minute

            // 4. Calculate Stats
            const totalDuration = meaningfulSessions.reduce((acc, s) => acc + s.durationMs, 0);

            // Sort newest first for timeline
            setSessions(meaningfulSessions.reverse());

            setStats(prev => ({
                ...prev,
                totalDuration,
                sessionCount: meaningfulSessions.length,
                avgSessionDuration: meaningfulSessions.length ? totalDuration / meaningfulSessions.length : 0
            }));

            setLoading(false);
        });

        return () => unsubscribe();
    }, [deviceId, date, packageName]);

    const formattedAppName = formatAppName(packageName, stats.appName);

    return (
        <div className="min-h-screen bg-zinc-950 text-zinc-100 p-4 md:p-8 font-sans selection:bg-rose-500/30">
            {/* Header */}
            <header className="mb-8 max-w-4xl mx-auto">
                <button
                    onClick={() => router.back()}
                    className="flex items-center gap-2 text-zinc-400 hover:text-white transition-colors mb-6 group"
                >
                    <ArrowLeft className="w-4 h-4 group-hover:-translate-x-1 transition-transform" />
                    Back to Dashboard
                </button>

                <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-6 pb-8 border-b border-zinc-900">
                    <div className="flex items-center gap-6">
                        <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-rose-500 to-orange-600 flex items-center justify-center text-3xl font-bold shadow-lg shadow-rose-900/20 text-white">
                            {formattedAppName.charAt(0).toUpperCase()}
                        </div>
                        <div>
                            <h1 className="text-3xl md:text-4xl font-bold text-white mb-2 tracking-tight">
                                {formattedAppName}
                            </h1>
                            <div className="flex items-center gap-3 text-zinc-400 text-sm">
                                <span className="flex items-center gap-1.5 bg-zinc-900 px-3 py-1 rounded-full border border-zinc-800">
                                    <Smartphone className="w-3.5 h-3.5" />
                                    {deviceId}
                                </span>
                                <span className="flex items-center gap-1.5 bg-zinc-900 px-3 py-1 rounded-full border border-zinc-800">
                                    <Calendar className="w-3.5 h-3.5" />
                                    {date}
                                </span>
                            </div>
                        </div>
                    </div>

                    <div className="flex gap-4">
                        <div className="bg-zinc-900 border border-zinc-800 p-4 rounded-2xl min-w-[140px]">
                            <div className="text-zinc-500 text-xs font-medium uppercase tracking-wider mb-1">Total Time</div>
                            <div className="text-3xl font-bold text-white tracking-tight">{formatDuration(stats.totalDuration)}</div>
                        </div>
                        <div className="bg-zinc-900 border border-zinc-800 p-4 rounded-2xl min-w-[140px]">
                            <div className="text-zinc-500 text-xs font-medium uppercase tracking-wider mb-1">Sessions</div>
                            <div className="text-3xl font-bold text-white tracking-tight">{stats.sessionCount}</div>
                        </div>
                    </div>
                </div>
            </header>

            {/* Timeline */}
            <main className="max-w-3xl mx-auto">
                <div className="flex items-center justify-between mb-8">
                    <h2 className="text-xl font-semibold flex items-center gap-2 text-zinc-200">
                        <Activity className="w-5 h-5 text-indigo-500" />
                        Session History
                    </h2>
                    <div className="flex items-center gap-2 text-xs text-zinc-500 bg-zinc-900 px-3 py-1.5 rounded-full border border-zinc-800">
                        <Filter className="w-3 h-3" />
                        Showing sessions &gt; 1 minute
                    </div>
                </div>

                {loading ? (
                    <div className="flex justify-center py-20">
                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-500"></div>
                    </div>
                ) : sessions.length === 0 ? (
                    <div className="text-center py-24 text-zinc-500 bg-zinc-900/40 rounded-3xl border border-zinc-800 border-dashed">
                        <p className="mb-2">No significant usage detected.</p>
                        <p className="text-xs text-zinc-600">Short sessions (&lt;1 min) are hidden to reduce noise.</p>
                    </div>
                ) : (
                    <div className="relative pl-8 space-y-8 before:absolute before:left-[11px] before:top-3 before:bottom-3 before:w-[2px] before:bg-zinc-800/50">
                        {sessions.map((session, idx) => (
                            <div key={idx} className="relative group">
                                {/* Timeline Dot */}
                                <div className={cn(
                                    "absolute -left-[29px] top-6 w-6 h-6 rounded-full border-[3px] border-zinc-950 flex items-center justify-center z-10 transition-all duration-300",
                                    session.isOngoing
                                        ? "bg-green-500 shadow-[0_0_15px_rgba(34,197,94,0.4)] scale-110"
                                        : "bg-zinc-800 group-hover:bg-indigo-500 group-hover:scale-110"
                                )}>
                                    {session.isOngoing && <div className="w-1.5 h-1.5 bg-white rounded-full animate-pulse" />}
                                </div>

                                {/* Content Card */}
                                <div className="bg-zinc-900/30 hover:bg-zinc-900/60 border border-zinc-800/60 hover:border-zinc-700/80 p-6 rounded-2xl transition-all duration-300 backdrop-blur-sm">
                                    <div className="flex justify-between items-start mb-4">
                                        <div className="space-y-1">
                                            <div className="flex items-center gap-3">
                                                <div className="text-2xl font-bold text-zinc-100 tracking-tight">
                                                    {new Date(session.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                                </div>
                                                <div className="h-px w-6 bg-zinc-800" />
                                                <div className="text-lg text-zinc-400">
                                                    {session.endTime
                                                        ? new Date(session.endTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                                                        : <span className="text-green-400 font-medium text-sm px-2 py-0.5 bg-green-500/10 rounded-full border border-green-500/20">Active Now</span>
                                                    }
                                                </div>
                                            </div>
                                            <div className="text-zinc-500 text-xs pl-0.5">
                                                {new Date(session.startTime).toLocaleDateString([], { month: 'short', day: 'numeric' })}
                                            </div>
                                        </div>

                                        <div className="text-right">
                                            <div className={cn(
                                                "font-bold text-xl tabular-nums tracking-tight",
                                                session.isOngoing ? "text-green-400" : "text-zinc-300"
                                            )}>
                                                {formatDuration(session.durationMs)}
                                            </div>
                                            <div className="text-[10px] text-zinc-600 font-medium uppercase tracking-wider mt-1">Duration</div>
                                        </div>
                                    </div>

                                    {/* Visual Bar */}
                                    <div className="w-full h-2 bg-zinc-800/50 rounded-full overflow-hidden mt-4">
                                        <div
                                            className={cn(
                                                "h-full rounded-full transition-all duration-1000",
                                                session.isOngoing
                                                    ? "bg-gradient-to-r from-green-500 to-emerald-400 animate-pulse"
                                                    : "bg-gradient-to-r from-indigo-500 to-purple-500 opacity-80"
                                            )}
                                            style={{ width: '100%' }}
                                        />
                                    </div>

                                    {/* Status Footer */}
                                    <div className="mt-4 flex items-center justify-between border-t border-zinc-800/50 pt-3">
                                        <div className="flex items-center gap-2 text-[10px] text-zinc-500 font-medium uppercase tracking-wider">
                                            <CheckCircle2 className={cn("w-3 h-3", session.isOngoing ? "text-green-500" : "text-indigo-500")} />
                                            {session.isOngoing ? "Session Active" : "Session Completed"}
                                        </div>
                                        {!session.endTime && (
                                            <div className="text-[10px] text-green-500/80 animate-pulse">Monitoring...</div>
                                        )}
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </main>
        </div>
    );
}
