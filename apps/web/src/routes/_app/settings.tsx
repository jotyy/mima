import { Badge } from "@mima/ui/components/badge";
import { Button } from "@mima/ui/components/button";
import { Input } from "@mima/ui/components/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@mima/ui/components/select";
import { Skeleton } from "@mima/ui/components/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@mima/ui/components/tabs";
import { DesktopIcon, DeviceMobileIcon } from "@phosphor-icons/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useTheme } from "next-themes";
import { type ReactNode, useState } from "react";

import { notify } from "@/components/notify";
import { Page, SectionTitle } from "@/components/page";
import {
	ChangePasswordDialog,
	ExportDialog,
} from "@/components/settings-dialogs";
import { authClient } from "@/lib/auth-client";
import { describeDevice } from "@/lib/device";
import { ago } from "@/lib/format";
import {
	AUTO_LOCK_CHOICES,
	type AutoLockMinutes,
	useKeyring,
} from "@/lib/keyring";
import { errorMessage, useWorkspace } from "@/lib/vault-data";
import { client } from "@/utils/orpc";

export const Route = createFileRoute("/_app/settings")({
	component: Settings,
});

const lockLabels: Record<AutoLockMinutes, string> = {
	5: "5 minutes",
	15: "15 minutes",
	30: "30 minutes",
	60: "1 hour",
	240: "4 hours",
};

function Settings() {
	const keyring = useKeyring();
	const workspace = useWorkspace();
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const { theme = "system", setTheme } = useTheme();
	const [changing, setChanging] = useState(false);
	const [exporting, setExporting] = useState(false);
	const me = keyring.me;
	if (!me) return null;
	const isAdmin = me.role !== "member";
	const workspaceName = workspace.data?.workspaceName ?? "mima";

	return (
		<Page
			title="Settings"
			description={`Your account in ${workspaceName}, and how mima behaves on this device.`}
		>
			<SectionTitle>Account</SectionTitle>
			<Card>
				<Row label="Name" hint="Shown to your team in vaults and activity.">
					<SaveField
						label="Name"
						value={me.name}
						onSave={async (name) => {
							await keyring.rename(name);
							notify.success("Name saved");
						}}
					/>
				</Row>
				<Row
					label="Email"
					hint="You sign in with it. Ask an admin to change it."
				>
					<span className="text-body-sm text-fg">{me.email}</span>
				</Row>
				<Row
					label="Master password"
					hint="Unlocks mima on every device. Nobody can reset it for you."
				>
					<Button variant="outline" onClick={() => setChanging(true)}>
						Change master password
					</Button>
				</Row>
			</Card>

			<SectionTitle>This device</SectionTitle>
			<Card>
				<Row
					label="Lock after"
					hint="Idle time before mima forgets the keys and asks for the master password."
				>
					<Select
						items={AUTO_LOCK_CHOICES.map((minutes) => ({
							value: String(minutes),
							label: lockLabels[minutes],
						}))}
						value={String(keyring.autoLockMinutes)}
						onValueChange={(value) => {
							const minutes = Number(value) as AutoLockMinutes;
							keyring.setAutoLockMinutes(minutes);
							notify.success(`mima now locks after ${lockLabels[minutes]}`);
						}}
					>
						<SelectTrigger className="w-40" aria-label="Lock after">
							<SelectValue />
						</SelectTrigger>
						<SelectContent align="end">
							{AUTO_LOCK_CHOICES.map((minutes) => (
								<SelectItem key={minutes} value={String(minutes)}>
									{lockLabels[minutes]}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</Row>
				<Row label="Theme">
					<Tabs
						value={theme}
						onValueChange={(value) => setTheme(String(value))}
					>
						<TabsList>
							<TabsTrigger value="light">Light</TabsTrigger>
							<TabsTrigger value="dark">Dark</TabsTrigger>
							<TabsTrigger value="system">System</TabsTrigger>
						</TabsList>
					</Tabs>
				</Row>
			</Card>

			<SectionTitle>Where you're signed in</SectionTitle>
			<Sessions />

			{isAdmin && (
				<>
					<SectionTitle>Workspace</SectionTitle>
					<Card>
						<Row
							label="Workspace name"
							hint="Shown on the sign-in page and to everyone you invite."
						>
							<SaveField
								label="Workspace name"
								value={workspaceName}
								onSave={async (name) => {
									await client.account.renameWorkspace({ name });
									await queryClient.invalidateQueries();
									notify.success("Workspace renamed");
								}}
							/>
						</Row>
					</Card>
				</>
			)}

			<SectionTitle>Data</SectionTitle>
			<Card>
				<Row
					label="Import"
					hint="Bring items in from 1Password, Bitwarden, a browser or any CSV."
				>
					<Button
						variant="outline"
						onClick={() => navigate({ to: "/items", search: { import: true } })}
					>
						Import items
					</Button>
				</Row>
				<Row
					label="Backup"
					hint="Every item you can open, decrypted into one CSV file. mima and most password managers can import it."
				>
					<Button variant="outline" onClick={() => setExporting(true)}>
						Download a backup
					</Button>
				</Row>
			</Card>

			<ChangePasswordDialog open={changing} onOpenChange={setChanging} />
			<ExportDialog open={exporting} onOpenChange={setExporting} />
		</Page>
	);
}

/** Browsers signed in to this account. The browser extension counts as one of them. */
function Sessions() {
	const queryClient = useQueryClient();
	const [busy, setBusy] = useState<string | null>(null);
	const sessions = useQuery({
		queryKey: ["sessions"],
		queryFn: async () => {
			const [list, current] = await Promise.all([
				authClient.listSessions(),
				authClient.getSession(),
			]);
			if (list.error) throw new Error(list.error.message);
			const currentId = current.data?.session.id;
			return (list.data ?? [])
				.map((session) => ({
					...session,
					current: session.id === currentId,
					device: describeDevice(session.userAgent),
				}))
				.sort(
					(a, b) =>
						Number(b.current) - Number(a.current) ||
						new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
				);
		},
	});
	const others = (sessions.data ?? []).filter((session) => !session.current);

	const end = async (id: string, work: () => Promise<{ error: unknown }>) => {
		setBusy(id);
		try {
			const { error } = await work();
			if (error) throw error;
			await queryClient.invalidateQueries({ queryKey: ["sessions"] });
			notify.success(
				id === "others" ? "Signed out everywhere else" : "Signed out",
			);
		} catch (err) {
			notify.error("Couldn't sign that out", errorMessage(err));
		} finally {
			setBusy(null);
		}
	};

	return (
		<Card>
			{sessions.isPending && (
				<div className="px-4 py-3.5">
					<Skeleton className="h-9" />
				</div>
			)}
			{sessions.data?.map((session) => {
				const Icon = session.device.phone ? DeviceMobileIcon : DesktopIcon;
				return (
					<div
						key={session.id}
						data-testid="session"
						className="flex items-center gap-3 px-4 py-3"
					>
						<span className="bg-surface-sunken text-fg-muted flex size-8 shrink-0 items-center justify-center rounded-lg">
							<Icon className="size-4" />
						</span>
						<div className="flex min-w-0 flex-1 flex-col gap-0.5">
							<span className="text-body-sm text-fg flex items-center gap-2">
								{session.device.label}
								{session.current && <Badge variant="brand">This browser</Badge>}
							</span>
							<span className="text-caption text-fg-muted">
								Signed in {ago(session.createdAt)}
							</span>
						</div>
						{!session.current && (
							<Button
								variant="outline"
								size="sm"
								disabled={busy !== null}
								aria-label={`Sign out ${session.device.label}`}
								onClick={() =>
									end(session.id, () =>
										authClient.revokeSession({ token: session.token }),
									)
								}
							>
								Sign out
							</Button>
						)}
					</div>
				);
			})}
			{others.length > 0 && (
				<Row
					label="Lost a device?"
					hint="Ends every other session. They'll need the master password to get back in."
				>
					<Button
						variant="outline"
						disabled={busy !== null}
						onClick={() =>
							end("others", () => authClient.revokeOtherSessions())
						}
					>
						Sign out everywhere else
					</Button>
				</Row>
			)}
		</Card>
	);
}

function Card({ children }: { children: ReactNode }) {
	return (
		<section className="rounded-window bg-surface shadow-card divide-line-subtle mb-8 flex flex-col divide-y">
			{children}
		</section>
	);
}

function Row({
	label,
	hint,
	children,
}: {
	label: string;
	hint?: string;
	children: ReactNode;
}) {
	return (
		<div className="flex flex-col gap-3 px-4 py-3.5 md:flex-row md:items-center md:justify-between md:gap-6">
			<div className="flex min-w-0 flex-col gap-0.5">
				<span className="text-body-sm text-fg">{label}</span>
				{hint && <span className="text-caption text-fg-muted">{hint}</span>}
			</div>
			<div className="flex shrink-0 items-center gap-2 max-md:w-full">
				{children}
			</div>
		</div>
	);
}

/** A text field that offers Save only once it differs from the stored value. */
function SaveField({
	label,
	value,
	onSave,
}: {
	label: string;
	value: string;
	onSave: (value: string) => Promise<void>;
}) {
	const [draft, setDraft] = useState(value);
	const [busy, setBusy] = useState(false);
	const changed = draft.trim() !== value && draft.trim() !== "";

	return (
		<form
			className="flex items-center gap-2 max-md:w-full"
			onSubmit={async (event) => {
				event.preventDefault();
				if (!changed) return;
				setBusy(true);
				try {
					await onSave(draft.trim());
				} catch (err) {
					notify.error("Couldn't save that", errorMessage(err));
				} finally {
					setBusy(false);
				}
			}}
		>
			<Input
				aria-label={label}
				className="md:w-56"
				value={draft}
				maxLength={80}
				onChange={(event) => setDraft(event.target.value)}
			/>
			<Button
				type="submit"
				variant={changed ? "default" : "outline"}
				disabled={!changed || busy}
			>
				Save
			</Button>
		</form>
	);
}
