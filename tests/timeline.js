/** @param {import('../worker/labeling.mjs').TimelineEvent[]} events
 * @returns {{data:{repository:{pullRequest:{timelineItems:{nodes: object[], pageInfo:{hasNextPage:boolean,endCursor:string|null}}}}}}}
 */
export function createTimelineAnswer(events) {
  const types = new Map([
    ["labeled", "LabeledEvent"],
    ["unlabeled", "UnlabeledEvent"],
    ["head_ref_force_pushed", "HeadRefForcePushedEvent"],
    ["commented", "IssueComment"],
  ]);
  return {
    data: {
      repository: {
        pullRequest: {
          timelineItems: {
            nodes: events.map(({ event, ...fields }) => ({
              ...fields,
              __typename: types.get(event),
            })),
            pageInfo: { hasNextPage: false, endCursor: null },
          },
        },
      },
    },
  };
}
