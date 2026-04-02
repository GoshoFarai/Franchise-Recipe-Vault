import React, { useState, useEffect } from 'react';
import { collection, onSnapshot, doc, updateDoc } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { Loader2, CheckCircle, XCircle, Clock } from 'lucide-react';

interface User {
  uid: string;
  email: string;
  displayName: string;
  status: 'pending' | 'approved' | 'rejected';
  requestedRole: string;
  role: string | null;
}

const STATUS_CONFIG = {
  pending:  { label: 'PENDING',  color: 'var(--amber)', bg: 'rgba(245,158,11,0.08)',  border: 'rgba(245,158,11,0.2)'  },
  approved: { label: 'APPROVED', color: 'var(--green)', bg: 'var(--green-bg)',         border: 'var(--green-dim)'       },
  rejected: { label: 'REJECTED', color: 'var(--red)',   bg: 'rgba(239,68,68,0.08)',   border: 'rgba(239,68,68,0.2)'   },
};

const ROLE_LABELS: Record<string, string> = {
  admin:   'ADMIN',
  manager: 'MANAGER',
  chef:    'CHEF',
  staff:   'STAFF',
};

export const AdminDashboard = () => {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'pending' | 'approved' | 'all'>('pending');
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  useEffect(() => {
    const usersRef = collection(db, 'users');
    const unsubscribe = onSnapshot(usersRef, (snapshot) => {
      const usersData = snapshot.docs.map(d => ({
        uid: d.id,
        ...d.data()
      })) as User[];
      setUsers(usersData);
      setLoading(false);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'users');
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  const approveUser = async (uid: string, requestedRole: string) => {
    setActionLoading(uid + '-approve');
    try {
      await updateDoc(doc(db, 'users', uid), {
        status: 'approved',
        role: requestedRole,
        approvedAt: new Date(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `users/${uid}`);
    } finally {
      setActionLoading(null);
    }
  };

  const rejectUser = async (uid: string) => {
    setActionLoading(uid + '-reject');
    try {
      await updateDoc(doc(db, 'users', uid), {
        status: 'rejected',
        role: null,
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `users/${uid}`);
    } finally {
      setActionLoading(null);
    }
  };

  const filteredUsers = users.filter(u => {
    if (activeTab === 'all') return true;
    return u.status === activeTab;
  });

  const pendingCount = users.filter(u => u.status === 'pending').length;

  if (loading) return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: '80px 0' }}>
      <Loader2 style={{ width: 24, height: 24, color: 'var(--green)', animation: 'spin 1s linear infinite' }} />
    </div>
  );

  return (
    <div style={{ padding: '0 16px 32px' }}>

      {/* Header */}
      <div style={{ marginBottom: '20px' }}>
        <h1 style={{
          fontFamily: 'var(--mono)',
          fontSize: '11px',
          fontWeight: '700',
          letterSpacing: '0.12em',
          color: 'var(--text-2)',
          marginBottom: '4px',
        }}>
          USER MANAGEMENT
        </h1>
        <div style={{
          fontFamily: 'var(--body)',
          fontSize: '24px',
          fontWeight: '600',
          color: 'var(--text-1)',
          letterSpacing: '-0.01em',
        }}>
          {pendingCount > 0 ? `${pendingCount} pending approval` : 'All users managed'}
        </div>
      </div>

      {/* Tabs */}
      <div style={{
        display: 'flex',
        gap: '8px',
        marginBottom: '16px',
        overflowX: 'auto',
        scrollbarWidth: 'none',
      }}>
        {(['pending', 'approved', 'all'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            style={{
              padding: '7px 14px',
              borderRadius: '20px',
              border: `1px solid ${activeTab === tab ? 'var(--green)' : 'var(--border)'}`,
              background: activeTab === tab ? 'var(--green-bg)' : 'var(--elevated)',
              color: activeTab === tab ? 'var(--green)' : 'var(--text-2)',
              fontFamily: 'var(--mono)',
              fontSize: '10px',
              fontWeight: '700',
              letterSpacing: '0.08em',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              flexShrink: 0,
            }}
          >
            {tab.toUpperCase()}
            {tab === 'pending' && pendingCount > 0 && (
              <span style={{
                marginLeft: '6px',
                background: 'var(--amber)',
                color: '#000',
                borderRadius: '10px',
                padding: '1px 6px',
                fontSize: '9px',
              }}>
                {pendingCount}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* User list */}
      {filteredUsers.length === 0 ? (
        <div style={{
          textAlign: 'center',
          padding: '48px 0',
          fontFamily: 'var(--mono)',
          fontSize: '10px',
          color: 'var(--text-3)',
          letterSpacing: '0.1em',
        }}>
          NO USERS IN THIS CATEGORY
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {filteredUsers.map(user => {
            const statusCfg = STATUS_CONFIG[user.status];
            return (
              <div
                key={user.uid}
                style={{
                  background: 'var(--surface)',
                  border: '1px solid var(--border)',
                  borderRadius: '12px',
                  padding: '14px 16px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '10px',
                }}
              >
                {/* User info */}
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px' }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{
                      fontFamily: 'var(--body)',
                      fontSize: '15px',
                      fontWeight: '500',
                      color: 'var(--text-1)',
                      marginBottom: '2px',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}>
                      {user.displayName || 'Unknown'}
                    </div>
                    <div style={{
                      fontFamily: 'var(--mono)',
                      fontSize: '10px',
                      color: 'var(--text-3)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}>
                      {user.email}
                    </div>
                  </div>

                  {/* Status badge */}
                  <div style={{
                    padding: '3px 8px',
                    borderRadius: '4px',
                    background: statusCfg.bg,
                    border: `1px solid ${statusCfg.border}`,
                    color: statusCfg.color,
                    fontFamily: 'var(--mono)',
                    fontSize: '9px',
                    fontWeight: '700',
                    letterSpacing: '0.08em',
                    whiteSpace: 'nowrap',
                    flexShrink: 0,
                  }}>
                    {statusCfg.label}
                  </div>
                </div>

                {/* Role info */}
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <div style={{
                    fontFamily: 'var(--mono)',
                    fontSize: '9px',
                    color: 'var(--text-3)',
                    letterSpacing: '0.06em',
                  }}>
                    REQUESTED:
                  </div>
                  <div style={{
                    padding: '2px 8px',
                    borderRadius: '4px',
                    background: 'var(--elevated)',
                    border: '1px solid var(--border)',
                    color: 'var(--text-2)',
                    fontFamily: 'var(--mono)',
                    fontSize: '9px',
                    fontWeight: '700',
                    letterSpacing: '0.08em',
                  }}>
                    {ROLE_LABELS[user.requestedRole] || user.requestedRole?.toUpperCase() || 'UNKNOWN'}
                  </div>
                  {user.role && (
                    <>
                      <div style={{ fontFamily: 'var(--mono)', fontSize: '9px', color: 'var(--text-3)' }}>→ GRANTED:</div>
                      <div style={{
                        padding: '2px 8px',
                        borderRadius: '4px',
                        background: 'var(--green-bg)',
                        border: '1px solid var(--green-dim)',
                        color: 'var(--green)',
                        fontFamily: 'var(--mono)',
                        fontSize: '9px',
                        fontWeight: '700',
                        letterSpacing: '0.08em',
                      }}>
                        {ROLE_LABELS[user.role] || user.role.toUpperCase()}
                      </div>
                    </>
                  )}
                </div>

                {/* Actions — only for pending */}
                {user.status === 'pending' && (
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button
                      onClick={() => approveUser(user.uid, user.requestedRole)}
                      disabled={!!actionLoading}
                      style={{
                        flex: 1,
                        padding: '10px',
                        background: 'var(--green-bg)',
                        border: '1px solid var(--green-dim)',
                        borderRadius: '8px',
                        color: 'var(--green)',
                        fontFamily: 'var(--mono)',
                        fontSize: '10px',
                        fontWeight: '700',
                        letterSpacing: '0.08em',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '6px',
                        opacity: actionLoading ? 0.5 : 1,
                      }}
                    >
                      {actionLoading === user.uid + '-approve'
                        ? <Loader2 style={{ width: 12, height: 12, animation: 'spin 1s linear infinite' }} />
                        : <CheckCircle style={{ width: 12, height: 12 }} />
                      }
                      APPROVE
                    </button>
                    <button
                      onClick={() => rejectUser(user.uid)}
                      disabled={!!actionLoading}
                      style={{
                        flex: 1,
                        padding: '10px',
                        background: 'rgba(239,68,68,0.06)',
                        border: '1px solid rgba(239,68,68,0.2)',
                        borderRadius: '8px',
                        color: 'var(--red)',
                        fontFamily: 'var(--mono)',
                        fontSize: '10px',
                        fontWeight: '700',
                        letterSpacing: '0.08em',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '6px',
                        opacity: actionLoading ? 0.5 : 1,
                      }}
                    >
                      {actionLoading === user.uid + '-reject'
                        ? <Loader2 style={{ width: 12, height: 12, animation: 'spin 1s linear infinite' }} />
                        : <XCircle style={{ width: 12, height: 12 }} />
                      }
                      REJECT
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
