'use client';

import { editableSetScores } from '../lib/tournament-set-result';

const CARD_STEP = 104;

function DoubleRoundGroup({ title, tournament, rounds, startRound, owner, userId,
  adminSelection, onAdminSelect, onStartMatch, scoreDraft, streamMatchId }) {
  if (!rounds.length) return null;
  const baseCount = rounds[0].length;
  const height = 64 + baseCount * CARD_STEP;
  return <div className="double-bracket-group">
    <h3 className="double-bracket-title">{title}</h3>
    <div className="bracket-rounds" style={{ '--bracket-height': height + 'px' }}>
      {rounds.map((round, localRi) => {
        const globalRi = startRound + localRi;
        const next = rounds[localRi + 1];
        const ratio = baseCount / round.length;
        const isPair = Boolean(next && round.length === next.length * 2);
        const isStraight = Boolean(next && round.length === next.length);
        let heading = '第' + (localRi + 1) + '回戦';
        if (title === '勝者側' && localRi === rounds.length - 1) heading = '勝者側決勝';
        if (title === '勝者側' && rounds.length > 2 && localRi === rounds.length - 2) heading = '準決勝';
        if (title === '敗者側' && localRi === rounds.length - 1) heading = '敗者側決勝';
        if (title === 'グランドファイナル') heading = localRi === 0 ? 'グランドファイナル' : 'リセット決勝';
        return <div className="bracket-round" key={globalRi}>
          <strong>{heading}</strong>
          {round.map((match, mi) => {
            const { player1, player2, winnerId } = match;
            const isBye = title === '勝者側' && localRi === 0 &&
              Boolean(player1) !== Boolean(player2);
            const top = 64 + (((mi + 0.5) * ratio) - 0.5) * CARD_STEP;
            if (isBye) return <div key={match.id} className="bracket-bye-spacer"
              style={{ top }} aria-hidden="true" />;
            const isOwnMatch = [player1, player2].some(player => player && !player.isDemo &&
              String(player.userId || player.id) === String(userId));
            const canStart = !match.matchState && (owner || isOwnMatch) &&
              player1 && player2 && !winnerId && !tournament.bracket.complete;
            const canSelect = owner || canStart;
            const select = () => {
              if (owner) onAdminSelect(globalRi, mi);
              else if (canStart) onStartMatch(globalRi, mi);
            };
            const isAdminSelected = owner && adminSelection?.roundIndex === globalRi &&
              adminSelection?.matchIndex === mi;
            const isStreamMatch = String(streamMatchId || '') === String(match.id);
            const scores = !tournament.stageRejects && !winnerId
              ? (scoreDraft?.matchId === String(match.id)
                ? scoreDraft.scores : editableSetScores(tournament, match))
              : match.matchState?.score || {};
            return <div key={match.id}
              className={`bracket-match${canSelect ? ' match-startable' : ''}${isAdminSelected ? ' match-admin-selected' : ''}${isStreamMatch ? ' match-streaming' : ''}`}
              style={{ top }} onClick={canSelect ? select : undefined}
              role={canSelect ? 'button' : undefined} tabIndex={canSelect ? 0 : undefined}
              aria-label={canSelect ? `${player1?.name || '未定'} 対 ${player2?.name || '未定'}の${owner ? '管理メニュー' : '対戦画面'}を開く` : undefined}
              onKeyDown={canSelect ? e => {
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(); }
              } : undefined}>
              {isStreamMatch && <span className="bracket-stream-badge">● 配信台</span>}
              <div className="match-players">
                {[player1, player2].map((player, pi) => {
                  const won = player && player1 && player2 && winnerId != null &&
                    String(winnerId) === String(player.id);
                  return <div key={pi}
                    className={'match-player-line' + (!player ? ' empty-player-line' : '') +
                      (won ? ' winner-line' : '') +
                      (player && winnerId != null && !won ? ' loser-line' : '')}>
                    <span title={player?.name || ''}>{player?.name || ''}{player?.isDemo ? '（デモ）' : ''}</span>
                    <strong className={'player-score' + (won ? ' score-winner' : '')}>
                      {!player ? '' : match.resultType === 'forfeit'
                        ? (won ? 'W' : '—')
                        : player1 && player2 ? (scores[player.id] ?? 0) : ''}
                    </strong>
                  </div>;
                })}
              </div>
              {isStraight && <svg className="bracket-connector" width="38" height="2"
                viewBox="0 0 38 2" aria-hidden="true">
                <path d="M0 1 H38" fill="none" stroke="#3170b8" strokeWidth="2" />
              </svg>}
              {isPair && mi % 2 === 0 && mi + 1 < round.length && (() => {
                const distance = CARD_STEP * ratio;
                const sibling = round[mi + 1];
                const visible = !(title === '勝者側' && localRi === 0 &&
                  Boolean(sibling.player1) !== Boolean(sibling.player2));
                return <svg className="bracket-connector" width="38" height={distance}
                  viewBox={`0 0 38 ${distance}`} aria-hidden="true">
                  <path d={visible
                    ? `M 0 0 H 19 V ${distance} M 19 ${distance / 2} H 38`
                    : `M 0 0 H 19 V ${distance / 2} H 38`}
                    fill="none" stroke="#3170b8" strokeWidth="2" />
                </svg>;
              })()}
              {isPair && mi % 2 === 1 &&
                !(title === '勝者側' && localRi === 0 &&
                  Boolean(round[mi - 1]?.player1) !== Boolean(round[mi - 1]?.player2)) &&
                <svg className="bracket-connector" width="19" height="2"
                  viewBox="0 0 19 2" aria-hidden="true">
                  <path d="M0 1 H19" fill="none" stroke="#3170b8" strokeWidth="2" />
                </svg>}
            </div>;
          })}
        </div>;
      })}
    </div>
  </div>;
}

// Use the site's EXISTING match card markup and CSS classes, not a different
// "double" card theme. Only the WB/LB/GF grouping is new.
export default function DoubleBracketView({ tournament, owner, userId, adminSelection,
  onAdminSelect, onStartMatch, scoreDraft, streamMatchId }) {
  const bracket = tournament.bracket;
  const wc = bracket.winnerRounds;
  const lc = bracket.loserRounds;
  const reset = bracket.rounds[wc + lc + 1]?.[0];
  const groups = [
    { title: '勝者側', start: 0, rounds: bracket.rounds.slice(0, wc) },
    { title: '敗者側', start: wc, rounds: bracket.rounds.slice(wc, wc + lc) },
    { title: 'グランドファイナル', start: wc + lc,
      rounds: bracket.rounds.slice(wc + lc, wc + lc + (reset?.player1 ? 2 : 1)) },
  ];
  return <div className="double-bracket-view">
    {groups.filter(group => group.rounds.length).map(group =>
      <DoubleRoundGroup key={group.title} title={group.title}
        tournament={tournament} rounds={group.rounds} startRound={group.start}
        owner={owner} userId={userId}
        adminSelection={adminSelection} onAdminSelect={onAdminSelect}
        onStartMatch={onStartMatch} scoreDraft={scoreDraft}
        streamMatchId={streamMatchId} />)}
    <style jsx global>{`
      .tournament-detail-page .double-bracket-title{
        margin:20px 0 10px;padding:0;color:#101b2d;
        font-size:16px;font-weight:800;
      }
      .tournament-detail-page .double-bracket-group:first-child .double-bracket-title{margin-top:12px}
      .tournament-detail-page .double-bracket-group .bracket-rounds{
        margin:0!important;border-radius:10px;
      }
    `}</style>
  </div>;
}
