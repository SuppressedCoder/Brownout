/**
 * Fields in boxes by folder (groupByFolder): each folder is shown once, at the
 * top of its box; a box inside another is named from there, and each row
 * shows only the rest of its key. A field alone in its folder is a plain row.
 */
import { Fragment, type ReactNode } from 'react';
import type { FolderGroup } from '@core/folders';
import { groupFields } from '@core/folders';
import { Icon } from './Icon';

export function FolderGroups<F extends { key: string }>({
  groups,
  row,
  testId,
  parent = '',
}: {
  groups: FolderGroup<F>[];
  /** One field's row; `name` is its key after the folder already shown above it. */
  row: (f: F, name: string) => ReactNode;
  testId?: string;
  parent?: string;
}) {
  return (
    <>
      {groups.map((g) => {
        if (g.fields.length === 1 && !g.groups.length) {
          const f = g.fields[0];
          return <Fragment key={f.key}>{row(f, f.key.slice(parent.length))}</Fragment>;
        }
        return (
          <div className="search-group" key={`group:${g.folder}`} data-testid={testId} data-folder={g.folder}>
            <div className="search-folder" title={g.folder}>
              <Icon name="folder" size={11} />
              <span className="path">
                <bdi>{g.folder.slice(parent.length) || '(top level)'}</bdi>
              </span>
              <span className="count">{groupFields([g]).length}</span>
            </div>
            {g.fields.map((f) => (
              <Fragment key={f.key}>{row(f, f.key.slice(g.folder.length))}</Fragment>
            ))}
            <FolderGroups groups={g.groups} row={row} testId={testId} parent={g.folder} />
          </div>
        );
      })}
    </>
  );
}
