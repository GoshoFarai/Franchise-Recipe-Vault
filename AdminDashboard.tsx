import React, { useState, useEffect } from 'react';
import { collection, onSnapshot, doc, updateDoc } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { Loader2 } from 'lucide-react';

interface User {
  uid: string;
  email: string;
  status: 'pending' | 'approved' | 'rejected';
}

export const AdminDashboard = () => {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'pending' | 'approved' | 'rejected'>('pending');

  useEffect(() => {
    const usersRef = collection(db, 'users');
    const unsubscribe = onSnapshot(usersRef, (snapshot) => {
      const usersData = snapshot.docs.map(doc => ({
        uid: doc.id,
        ...doc.data()
      })) as User[];
      setUsers(usersData);
      setLoading(false);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'users');
    });

    return () => unsubscribe();
  }, []);

  const approveUser = async (uid: string) => {
    try {
      await updateDoc(doc(db, 'users', uid), { status: 'approved' });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `users/${uid}`);
    }
  };

  const rejectUser = async (uid: string) => {
    try {
      await updateDoc(doc(db, 'users', uid), { status: 'rejected' });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `users/${uid}`);
    }
  };

  const filteredUsers = filter === 'all' ? users : users.filter(u => u.status === filter);

  if (loading) return <div className="flex justify-center py-20"><Loader2 className="w-8 h-8 animate-spin text-green" /></div>;

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-6">Admin Dashboard</h1>
      
      <div className="flex gap-2 mb-6">
        <button 
          onClick={() => setFilter('all')}
          className={`px-4 py-2 rounded ${filter === 'all' ? 'bg-green text-white' : 'bg-gray-200'}`}
        >
          All ({users.length})
        </button>
        <button 
          onClick={() => setFilter('pending')}
          className={`px-4 py-2 rounded ${filter === 'pending' ? 'bg-green text-white' : 'bg-gray-200'}`}
        >
          Pending ({users.filter(u => u.status === 'pending').length})
        </button>
        <button 
          onClick={() => setFilter('approved')}
          className={`px-4 py-2 rounded ${filter === 'approved' ? 'bg-green text-white' : 'bg-gray-200'}`}
        >
          Approved ({users.filter(u => u.status === 'approved').length})
        </button>
        <button 
          onClick={() => setFilter('rejected')}
          className={`px-4 py-2 rounded ${filter === 'rejected' ? 'bg-green text-white' : 'bg-gray-200'}`}
        >
          Rejected ({users.filter(u => u.status === 'rejected').length})
        </button>
      </div>

      <table className="w-full text-left border-collapse">
        <thead>
          <tr>
            <th className="border-b p-2">Email</th>
            <th className="border-b p-2">Status</th>
            <th className="border-b p-2">Action</th>
          </tr>
        </thead>
        <tbody>
          {filteredUsers.map(user => (
            <tr key={user.uid}>
              <td className="border-b p-2">{user.email}</td>
              <td className="border-b p-2">
                <span className={`px-3 py-1 rounded text-white ${
                  user.status === 'pending' ? 'bg-yellow-500' :
                  user.status === 'approved' ? 'bg-green' :
                  'bg-red-500'
                }`}>
                  {user.status}
                </span>
              </td>
              <td className="border-b p-2">
                {user.status === 'pending' && (
                  <div className="flex gap-2">
                    <button 
                      onClick={() => approveUser(user.uid)}
                      className="bg-green text-white px-3 py-1 rounded hover:bg-green/80"
                    >
                      Approve
                    </button>
                    <button 
                      onClick={() => rejectUser(user.uid)}
                      className="bg-red-500 text-white px-3 py-1 rounded hover:bg-red-600"
                    >
                      Reject
                    </button>
                  </div>
                )}
                {user.status !== 'pending' && (
                  <span className="text-gray-400">-</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {filteredUsers.length === 0 && (
        <p className="text-center text-gray-400 mt-6">No users with status: {filter}</p>
      )}
    </div>
  );
};