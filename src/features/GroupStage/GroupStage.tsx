import { useEffect, useMemo } from 'react';
import { GROUP_IDS } from '../../domain/types';
import { useTournamentStore } from '../../store/tournamentStore';
import { GroupCard } from './GroupCard';
import { useGroupData } from './useGroupData';
import { computeAllStandings } from '../../domain/standings';
import { isGroupComplete } from '../../domain/elimination';

export function GroupStage() {
  const teams = useTournamentStore((s) => s.teams);
  const matches = useTournamentStore((s) => s.matches);
  const setGroupOrder = useTournamentStore((s) => s.setGroupOrder);

  const teamList = useMemo(() => Object.values(teams), [teams]);

  // Seed (or re-seed) each group's order whenever teams or live matches change.
  // Groups the user has manually dragged are left alone — we detect them by
  // checking whether the current order still matches pot order (TEAMS list order).
  // `useTournamentStore.getState()` reads the latest groupOrder snapshot without
  // subscribing, which prevents this effect from looping on its own writes.
  useEffect(() => {
    if (teamList.length === 0) return;

    const teamsById = Object.fromEntries(teamList.map((t) => [t.id, t]));
    const standingsMap = computeAllStandings(teamsById, matches);
    const { groupOrder } = useTournamentStore.getState();

    for (const g of GROUP_IDS) {
      const potOrder = teamList.filter((t) => t.groupId === g).map((t) => t.id);
      const current = groupOrder[g] ?? [];

      // Always re-seed completed groups from locked final standings so stale
      // localStorage can't persist a wrong order after all results are in.
      // For in-progress groups, skip re-seeding only if the user has manually
      // reordered (detected by divergence from pot order).
      const complete = isGroupComplete(g, matches);
      const untouched =
        complete ||
        current.length === 0 ||
        potOrder.every((id, i) => id === current[i]);
      if (!untouched) continue;

      const gs = standingsMap[g] ?? [];
      const idealOrder = gs.some((s) => s.played > 0)
        ? gs.map((s) => s.teamId)
        : potOrder;

      setGroupOrder(g, idealOrder);
    }
  }, [teamList, matches, setGroupOrder]);

  const groupData = useGroupData();

  const teamsByGroup = useMemo(() => {
    const map: Record<string, typeof teamList> = {};
    for (const g of GROUP_IDS) map[g] = [];
    for (const t of teamList) map[t.groupId].push(t);
    return map;
  }, [teamList]);

  if (teamList.length === 0) {
    return <p className="screen-intro">Loading groups…</p>;
  }

  return (
    <div>
      <p className="screen-intro">
        Drag teams within each group to set the final standings. Top 2 advance; the best 8 third-place teams also progress.
      </p>
      <div className="group-grid">
        {GROUP_IDS.map((g) => (
          <GroupCard
            key={g}
            groupId={g}
            teams={teamsByGroup[g]}
            groupData={groupData[g]}
          />
        ))}
      </div>
    </div>
  );
}
