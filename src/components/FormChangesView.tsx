
import { useQuery } from "@tanstack/react-query";
import { submissionService } from "@/services/submissionService";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { Loader2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { fetchAllRows } from "@/lib/supabasePaging";

interface FormChangesViewProps {
    recordUuid: string;
    submissionId: string;
}

export const FormChangesView = ({ recordUuid, submissionId }: FormChangesViewProps) => {
    const { data: changes, isLoading, isError } = useQuery({
        queryKey: ["formchanges", recordUuid],
        queryFn: () => submissionService.getFormChanges(recordUuid),
    });
    const serverAudit = useQuery({
        queryKey: ['server-audit', submissionId],
        queryFn: () => fetchAllRows<{
            id: number; operation: string; occurred_at: string; uploader_username: string | null;
            actor_user_id: string | null; old_values: { data?: Record<string, unknown> } | null;
            new_values: { data?: Record<string, unknown> } | null;
        }>((from, to) => supabase.from('system_audit_events').select('*')
            .eq('entity_type', 'submissions').eq('entity_id', submissionId).order('id').range(from, to)),
    });

    if (isLoading) {
        return (
            <div className="flex justify-center p-4">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
        );
    }

    return (
        <div className="space-y-4">
            <h4 className="font-medium">Device history</h4>
            {isError && <p role="alert">Device history could not be retrieved.</p>}
            {!isError && !changes?.length && <p>No device history was recorded for this record.</p>}
            <div className="rounded-md border">
            <Table>
                <TableHeader>
                    <TableRow>
                        <TableHead>Field</TableHead>
                        <TableHead>Old Value</TableHead>
                        <TableHead>New Value</TableHead>
                        <TableHead>Changed By</TableHead>
                        <TableHead>Time</TableHead>
                        <TableHead>Reason</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {(changes ?? []).map((change) => (
                        <TableRow key={change.id}>
                            <TableCell className="font-medium">{change.fieldname}</TableCell>
                            <TableCell className="text-red-500 font-mono text-xs">
                                {change.oldvalue || <span className="text-muted-foreground italic">empty</span>}
                            </TableCell>
                            <TableCell className="text-green-600 font-mono text-xs">
                                {change.newvalue || <span className="text-muted-foreground italic">empty</span>}
                            </TableCell>
                            <TableCell className="text-muted-foreground text-sm">{change.surveyor_id}</TableCell>
                            <TableCell className="text-muted-foreground text-sm">
                                {change.event_time_utc ?? (change.changed_at ? (/Z$|[+-]\d\d:\d\d$/.test(change.changed_at) ? change.changed_at : `${change.changed_at} (device timezone unknown)`) : 'Time not recorded')}
                            </TableCell>
                            <TableCell>{change.reason_for_change ?? 'Not recorded in this version'}</TableCell>
                        </TableRow>
                    ))}
                </TableBody>
            </Table>
            </div>
            <h4 className="font-medium">Server history</h4>
            <p className="text-sm text-muted-foreground">Server observations retain initial values and later revisions. The uploader may differ from the original offline editor. Earlier versions may have no server history.</p>
            {serverAudit.isPending && <p>Loading server history…</p>}
            {serverAudit.isError && <p role="alert">Server history could not be retrieved.</p>}
            {serverAudit.data?.map(event => {
                const before = event.old_values?.data ?? {};
                const after = event.new_values?.data ?? {};
                const fields = [...new Set([...Object.keys(before), ...Object.keys(after)])]
                    .filter(field => JSON.stringify(before[field]) !== JSON.stringify(after[field]));
                return <div key={event.id} className="rounded-md border p-3 space-y-2">
                    <p className="text-sm">{event.operation} · {event.occurred_at} · Uploader {event.uploader_username ?? 'not recorded'} · Portal actor {event.actor_user_id ?? 'not applicable'}</p>
                    <Table><TableHeader><TableRow><TableHead>Field</TableHead><TableHead>Previous value</TableHead><TableHead>Recorded value</TableHead></TableRow></TableHeader>
                        <TableBody>{fields.map(field => <TableRow key={field}><TableCell>{field}</TableCell><TableCell className="break-all">{JSON.stringify(before[field]) ?? 'not present'}</TableCell><TableCell className="break-all">{JSON.stringify(after[field]) ?? 'not present'}</TableCell></TableRow>)}</TableBody>
                    </Table>
                </div>;
            })}
        </div>
    );
};
