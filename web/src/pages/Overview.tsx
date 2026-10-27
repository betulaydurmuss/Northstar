import { Plus } from 'lucide-react';
import { EmptyState } from '../components/States';

export function Overview() {
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Overview</h1>
          <p className="muted">Every client site you look after, in one place.</p>
        </div>
      </div>
      <EmptyState
        title="No monitors yet"
        body="Add the first site you want Northstar to watch. We check it every minute and email you the moment it goes down."
        action={
          <button className="btn btn-primary" disabled>
            <Plus size={16} /> Add a monitor
          </button>
        }
      />
    </>
  );
}
