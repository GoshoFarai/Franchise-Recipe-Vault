import React, { useEffect, useState, createContext, useContext } from 'react';
import { auth, firestore } from '../firebase';

const AuthContext = createContext();

export function AuthProvider({ children }) {
    const [currentUser, setCurrentUser] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const unsubscribe = auth.onAuthStateChanged(user => {
            setCurrentUser(user);
            setLoading(false);
        });

        return () => unsubscribe();
    }, []);

    useEffect(() => {
        if (currentUser) {
            const unsubscribe = firestore
                .collection('users')
                .doc(currentUser.uid)
                .onSnapshot(doc => {
                    if (doc.exists) {
                        setCurrentUser({ ...currentUser, profile: doc.data() });
                    }
                });

            return () => unsubscribe();
        } else {
            setCurrentUser(null);
        }
    }, [currentUser]);

    const resetState = () => { setCurrentUser(null); };

    return (
        <AuthContext.Provider value={{ currentUser, resetState }}>
            {!loading && children}
        </AuthContext.Provider>
    );
}

export function useAuth() {
    return useContext(AuthContext);
}