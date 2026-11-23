'use client';

import { editableSetScores } from '../lib/tournament-set-result';
import { playableLoserRoundIndices } from '../lib/tournament-double-elim';

const CARD_STEP = 104;

function DoubleRoundGroup({ title, tournament, rounds, roundIndices, winnerRoundCount, owner, userId,
  adminSelection, onAdminSelect, onStartMatch, scoreDraft, streamMatchId }) {
  if (!rounds.length) return null;
  const baseCount = rounds[0].length;
  const height = 64 + baseCount * CARD_STEP;
  return <div className="double-bracket-group">
    <h3 className="double-bracket-title">{title}</h3>
    <div className="bracket-rounds" style={{ '--bracket-height': height + 'px' }}>
      {rounds.map((round, localRi) => {
        const globalRi = roundIndices[localRi];
        const next = rounds[localRi + 1];
        const ratio = baseCount / round.length;
        const isPair = Boolean(next && round.length === next.length * 2);
        const isStraight = Boolean(next && round.length === next.length);
        let heading = '第' + (localRi + 1) + '回戦';
        if (title === '勝者側') {
          // Grand finals continue rightward from the winners final, on the
          // same horizontal row. Only the losers bracket occupies a new row.
          if (localRi === winnerRoundCount - 1) heading = '勝者側決勝';
          else if (winnerRoundCount > 2 && localRi === winnerRoundCount - 2) heading = '準決勝';
          else if (localRi === winnerRoundCount) heading = 'グランドファイナル';
          else if (localRi > winnerRoundCount) heading = 'グランドファイナルリセット';
        }
        if (title === '敗者側' && localRi === rounds.length - 1) heading = '敗者側決勝';
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
  const finals = bracket.rounds.slice(wc + lc, wc + lc + (reset?.player1 ? 2 : 1));
  const winnerRounds = bracket.rounds.slice(0, wc);
  const visibleLoserIndices = playableLoserRoundIndices(bracket);
  // All rounds keep their original global indices. Hidden automatic BYE
  // columns must not affect match selection, score reporting or routing.
  const loserRounds = visibleLoserIndices.map(index => bracket.rounds[index]);
  const groups = [
    { title: '勝者側', rounds: [...winnerRounds, ...finals],
      roundIndices: [...winnerRounds.map((_, i) => i), ...finals.map((_, i) => wc + lc + i)],
      winnerRoundCount: wc },
    { title: '敗者側', rounds: loserRounds,
      roundIndices: visibleLoserIndices, winnerRoundCount: 0 },
  ].filter(group => group.rounds.length);
  // One shared horizontal canvas/scrollbar for WB and LB. No second panel.
  const maxColumns = Math.max(...groups.map(group => group.rounds.length));
  const minCanvasWidth = maxColumns * 268 + (maxColumns - 1) * 38 + 4;
  return <div className="double-bracket-view">
    <div className="double-bracket-track" style={{ minWidth: minCanvasWidth }}>
      {groups.map(group =>
        <DoubleRoundGroup key={group.title} title={group.title}
          tournament={tournament} rounds={group.rounds}
          roundIndices={group.roundIndices} winnerRoundCount={group.winnerRoundCount}
          owner={owner} userId={userId}
          adminSelection={adminSelection} onAdminSelect={onAdminSelect}
          onStartMatch={onStartMatch} scoreDraft={scoreDraft}
          streamMatchId={streamMatchId} />)}
    </div>
    <style jsx global>{`
      .tournament-detail-page .tournament-live-panel .double-bracket-view{
        box-sizing:border-box;width:100%;overflow-x:auto;overflow-y:hidden;
        padding:18px 24px 28px;background:#e9edf2;
        -webkit-overflow-scrolling:touch;scrollbar-width:thin;
      }
      .tournament-detail-page .tournament-live-panel .double-bracket-track{
        box-sizing:border-box;width:100%;background:transparent;
      }
      .tournament-detail-page .tournament-live-panel .double-bracket-group{
        background:transparent;margin:0;padding:0;
      }
      .tournament-detail-page .tournament-live-panel .double-bracket-group + .double-bracket-group{
        border-top:1px solid #c3cfdb;margin-top:16px;padding-top:16px;
      }
      .tournament-detail-page .double-bracket-title{
        margin:0 0 10px;padding:0;color:#101b2d;
        font-size:16px;font-weight:800;
      }
      .tournament-detail-page .tournament-live-panel .double-bracket-group .bracket-rounds{
        box-sizing:border-box;display:flex;overflow:visible!important;
        width:100%;margin:0!important;padding:0!important;
        background:transparent!important;border-radius:0!important;
      }
    `}</style>
  </div>;
}
