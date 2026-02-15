"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { db } from "@/lib/firebase";
import { collection, onSnapshot } from "firebase/firestore";
import { formatDuration, cn, formatAppName } from "@/lib/utils";
import {
    ArrowLeft,
    Calendar,
    Smartphone,
    ChevronDown,
    ChevronRight,
    Clock,
    Zap,
    MessageCircle,
    Gamepad2,
    Briefcase,
    MonitorPlay
} from "lucide-react";

// Types
interface UsageEvent {
    packageName: string;
    appName: string;
    eventType: "APP_OPENED" | "APP_CLOSED" | "UNKNOWN";
    timestamp: number;
    time: string;
}

interface ThreadSegment {
    idx: number; // Order in session
    pkg: string;
    appName: string;
    action: "OPEN" | "CLOSE" | "SWITCH";
    timestamp: number;
    durationMs?: number; // Duration until next event in thread
}

interface ActivitySession {
    id: string; // Unique ID (e.g., start timestamp)
    startTime: number;
    endTime: number;
    totalDuration: number;
    dominantApp: { name: string; pkg: string; usage: number }; // Most used app in session
    appCount: number; // Unique apps touched
    thread: ThreadSegment[]; // The detailed event list
    category: "Game" | "Social" | "Productivity" | "General"; // Inferred
}

export default function ActivityTimelinePage() {
    const params = useParams();
    const router = useRouter();
    const { deviceId, date } = params as { deviceId: string, date: string };

    const [sessions, setSessions] = useState<ActivitySession[]>([]);
    const [loading, setLoading] = useState(true);
    const [expandedSessionId, setExpandedSessionId] = useState<string | null>(null);

    // --- Logic: Session Clustering ---
    // Rule: events < 2 mins apart belong to the same session.
    // Rule: Session ends if gap > 2 mins.
    const clusterEventsCheck = (current: UsageEvent, next: UsageEvent) => {
        const gap = next.timestamp - current.timestamp;
        return gap < 120000; // 2 minutes in ms
    };

    const inferCategory = (dominantAppName: string): ActivitySession["category"] => {
        const lower = dominantAppName.toLowerCase();
        if (lower.includes("pubg") || lower.includes("cod") || lower.includes("game") || lower.includes("clash")) return "Game";
        if (lower.includes("whatsapp") || lower.includes("instagram") || lower.includes("snapchat") || lower.includes("telegram")) return "Social";
        if (lower.includes("docs") || lower.includes("sheets") || lower.includes("mail") || lower.includes("slack")) return "Productivity";
        return "General";
    };

    const getCategoryIcon = (cat: ActivitySession["category"]) => {
        switch (cat) {
            case "Game": return Gamepad2;
            case "Social": return MessageCircle;
            case "Productivity": return Briefcase;
            default: return Zap;
        }
    };

    useEffect(() => {
        if (!deviceId || !date) return;
        setLoading(true);

        const dateCollectionRef = collection(db, "sanary_monitor", deviceId, date);

        const unsubscribe = onSnapshot(dateCollectionRef, (snapshot) => {
            let allEvents: UsageEvent[] = [];

            snapshot.forEach(doc => {
                if (doc.id.startsWith("events_")) {
                    const data = doc.data();
                    if (data.events && Array.isArray(data.events)) {
                        const events = data.events.map((e: any) => ({
                            packageName: e.packageName,
                            appName: e.appName,
                            eventType: e.eventType === "APP_OPENED" || e.eventType === "APP_CLOSED" ? e.eventType : "UNKNOWN",
                            timestamp: e.timestamp,
                            time: e.time
                        }));
                        allEvents.push(...events);
                    }
                }
            });

            // 1. Sort all events chronologically
            allEvents.sort((a, b) => a.timestamp - b.timestamp);

            if (allEvents.length === 0) {
                setSessions([]);
                setLoading(false);
                return;
            }

            // 2. Cluster into Sessions
            const reconstructedSessions: ActivitySession[] = [];
            let currentCluster: UsageEvent[] = [allEvents[0]];

            // Helper to finalize a cluster
            const finalizeCluster = (cluster: UsageEvent[]) => {
                if (cluster.length > 0) {
                    reconstructedSessions.push(processCluster(cluster));
                }
            };

            for (let i = 1; i < allEvents.length; i++) {
                const prev = allEvents[i - 1];
                const curr = allEvents[i];

                if (clusterEventsCheck(prev, curr)) {
                    currentCluster.push(curr);
                } else {
                    // Finalize previous cluster
                    finalizeCluster(currentCluster);
                    // Start new cluster
                    currentCluster = [curr];
                }
            }
            // Finalize last cluster
            finalizeCluster(currentCluster);

            // 3. Filter weak sessions (< 10s)
            // User requested "Juice out as much info", but keep it clean.
            // 10s seems safe to avoid accidental screen on/off spam.
            const meaningfulSessions = reconstructedSessions.filter(s => s.totalDuration > 10000);

            setSessions(meaningfulSessions.reverse()); // Newest first
            setLoading(false);
        });

        return () => unsubscribe();
    }, [deviceId, date]);

    const processCluster = (events: UsageEvent[]): ActivitySession => {
        const startTime = events[0].timestamp;
        const endTime = events[events.length - 1].timestamp;

        let totalDuration = endTime - startTime;
        if (totalDuration < 1000) totalDuration = 1000; // Min 1s

        // Determine Dominant App
        const appUsage: Record<string, number> = {};
        events.forEach(e => {
            appUsage[e.appName] = (appUsage[e.appName] || 0) + 1;
        });

        let dominantApp = { name: "Unknown", pkg: "", usage: 0 };
        Object.entries(appUsage).forEach(([name, count]) => {
            if (count > dominantApp.usage) {
                // Find pkg from events
                const pkg = events.find(e => e.appName === name)?.packageName || "";
                dominantApp = { name, pkg, usage: count };
            }
        });

        // Unique apps
        const uniqueApps = new Set(events.map(e => e.packageName)).size;

        // Build Thread
        const thread: ThreadSegment[] = events.map((e, idx) => {
            const nextE = events[idx + 1];
            // Calculate duration of THIS event state until next change
            const durationMs = nextE ? nextE.timestamp - e.timestamp : 0;

            return {
                idx,
                pkg: e.packageName,
                appName: e.appName,
                action: e.eventType === "APP_OPENED" ? "OPEN" : "CLOSE" as any,
                timestamp: e.timestamp,
                durationMs
            };
        });

        return {
            id: startTime.toString(), // Unique ID based on start
            startTime,
            endTime,
            totalDuration,
            dominantApp,
            appCount: uniqueApps,
            thread,
            category: inferCategory(dominantApp.name)
        };
    };

    const toggleSession = (id: string) => {
        console.log("Toggling session:", id);
        const session = sessions.find(s => s.id === id);
        if (session) {
            console.log("Session details:", {
                app: session.dominantApp.name,
                threadCount: session.thread.length,
                totalDuration: session.totalDuration
            });
        }
        setExpandedSessionId(prev => prev === id ? null : id);
    };

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
                    <div>
                        <h1 className="text-3xl md:text-4xl font-bold text-white mb-2 tracking-tight flex items-center gap-3">
                            <MonitorPlay className="w-8 h-8 text-rose-500" />
                            Device Activity
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

                    <div className="flex gap-4">
                        <div className="bg-zinc-900 border border-zinc-800 p-4 rounded-2xl min-w-[140px]">
                            <div className="text-zinc-500 text-xs font-medium uppercase tracking-wider mb-1">Total Sessions</div>
                            <div className="text-3xl font-bold text-white tracking-tight">{sessions.length}</div>
                        </div>
                    </div>
                </div>
            </header>

            {/* Timeline Main */}
            <main className="max-w-3xl mx-auto relative pl-6 md:pl-0">
                {/* Vertical Spine (Desktop) */}
                <div className="absolute left-[-21px] md:left-0 top-0 bottom-0 w-px bg-zinc-800/50 hidden md:block" />

                {loading ? (
                    <div className="flex justify-center py-20">
                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-500"></div>
                    </div>
                ) : sessions.length === 0 ? (
                    <div className="text-center py-24 text-zinc-500 bg-zinc-900/40 rounded-3xl border border-zinc-800 border-dashed">
                        <p>No significant activity recorded for this day.</p>
                    </div>
                ) : (
                    <div className="space-y-6">
                        {sessions.map((session) => {
                            const Icon = getCategoryIcon(session.category);
                            const isExpanded = expandedSessionId === session.id;

                            return (
                                <div key={session.id} className="relative md:pl-10 group">
                                    {/* Timeline Node (Desktop) */}
                                    <div className={cn(
                                        "absolute left-[-6px] top-6 w-3 h-3 rounded-full border-2 border-zinc-950 z-10 transition-all duration-300 hidden md:block",
                                        isExpanded ? "bg-rose-500 scale-125 shadow-[0_0_10px_rgba(244,63,94,0.5)]" : "bg-zinc-700 group-hover:bg-zinc-500"
                                    )} />

                                    {/* Session Card */}
                                    <div
                                        onClick={() => toggleSession(session.id)}
                                        className={cn(
                                            "bg-zinc-900/40 border rounded-2xl overflow-hidden transition-all duration-300 cursor-pointer hover:bg-zinc-900/60",
                                            isExpanded ? "border-zinc-700 shadow-2xl shadow-black/50 ring-1 ring-zinc-700/50" : "border-zinc-800/60 hover:border-zinc-700"
                                        )}
                                    >
                                        {/* Macro View (Header) */}
                                        <div className="p-5 flex items-center gap-4">
                                            {/* Icon Box */}
                                            <div className={cn(
                                                "w-12 h-12 rounded-xl flex items-center justify-center shrink-0 transition-colors duration-300",
                                                isExpanded ? "bg-rose-500/20 text-rose-400" : "bg-zinc-800/50 text-zinc-400"
                                            )}>
                                                <Icon className="w-6 h-6" />
                                            </div>

                                            {/* Text Content */}
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center gap-2 mb-1">
                                                    <h3 className="font-bold text-lg text-zinc-100 truncate">
                                                        {formatAppName(session.dominantApp.pkg, session.dominantApp.name)}
                                                        <span className="text-zinc-500 font-normal ml-2 text-sm">Session</span>
                                                    </h3>
                                                    {session.appCount > 1 && (
                                                        <span className="text-[10px] px-2 py-0.5 bg-zinc-800 rounded-full text-zinc-400 border border-zinc-700 font-medium">
                                                            +{session.appCount - 1} apps
                                                        </span>
                                                    )}
                                                </div>
                                                <div className="flex items-center gap-3 text-sm text-zinc-400">
                                                    <div className="flex items-center gap-1.5 font-mono text-xs">
                                                        <Clock className="w-3.5 h-3.5 text-zinc-500" />
                                                        {new Date(session.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                                        {" - "}
                                                        {new Date(session.endTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                                    </div>
                                                    <div className="w-1 h-1 bg-zinc-700 rounded-full" />
                                                    <div className="text-zinc-300 font-bold">
                                                        {formatDuration(session.totalDuration)}
                                                    </div>
                                                </div>
                                            </div>

                                            {/* Arrow */}
                                            <div className="text-zinc-600 transition-transform duration-300">
                                                {isExpanded ? <ChevronDown className="w-5 h-5 rotate-180" /> : <ChevronRight className="w-5 h-5" />}
                                            </div>
                                        </div>

                                        {/* Micro View (Thread) - Content */}
                                        {isExpanded && (
                                            <div className="border-t border-zinc-800/50 bg-black/20 animate-in fade-in slide-in-from-top-1 duration-200">
                                                <div className="p-5 space-y-4 relative">
                                                    {/* Thread Spine */}
                                                    <div className="absolute left-[39px] top-6 bottom-6 w-px bg-zinc-800/40" />

                                                    {session.thread.length === 0 ? (
                                                        <div className="text-zinc-500 text-sm pl-12">No detailed events recorded for this session.</div>
                                                    ) : (
                                                        session.thread.map((event, tIdx) => (
                                                            <div key={tIdx} className="relative flex items-start gap-4 group/thread">
                                                                {/* Time */}
                                                                <div className="w-16 text-right text-[10px] text-zinc-500 font-mono pt-1">
                                                                    {new Date(event.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                                                                </div>

                                                                {/* Dot */}
                                                                <div className={cn(
                                                                    "w-2.5 h-2.5 rounded-full border-2 border-zinc-950 z-10 shrink-0 mt-1.5 transition-transform group-hover/thread:scale-125",
                                                                    event.action === "OPEN" ? "bg-green-500 box-shadow-green" : "bg-zinc-600"
                                                                )} />

                                                                {/* Event Details */}
                                                                <div className="flex-1 min-w-0 pb-2">
                                                                    <div className="flex items-center gap-2 mb-1">
                                                                        <span className={cn(
                                                                            "text-sm font-semibold tracking-tight",
                                                                            event.action === "OPEN" ? "text-zinc-200" : "text-zinc-500 line-through decoration-zinc-700 decoration-2"
                                                                        )}>
                                                                            {formatAppName(event.pkg, event.appName)}
                                                                        </span>
                                                                        <span className={cn(
                                                                            "text-[10px] px-1.5 py-0.5 rounded border uppercase tracking-wider font-bold",
                                                                            event.action === "OPEN"
                                                                                ? "bg-green-500/10 text-green-500 border-green-500/20"
                                                                                : "bg-zinc-800 text-zinc-500 border-zinc-700"
                                                                        )}>
                                                                            {event.action}
                                                                        </span>
                                                                    </div>
                                                                    {/* State Duration */}
                                                                    {event.durationMs && event.durationMs > 1000 && event.action === "OPEN" && (
                                                                        <div className="flex items-center gap-2 text-[11px] text-zinc-400 bg-zinc-800/30 px-2 py-1 rounded inline-block border border-zinc-800/50">
                                                                            <span>⚡ Active for</span>
                                                                            <span className="text-zinc-200 font-mono font-medium">{formatDuration(event.durationMs)}</span>
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            </div>
                                                        ))
                                                    )}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </main>
        </div>
    );
}
