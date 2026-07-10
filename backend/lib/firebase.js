import * as admin from 'firebase-admin';
import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import dotenv from 'dotenv';

dotenv.config();

let db;
let storage;

try {
    const apps = getApps();
    if (apps.length === 0) {
        const privateKey = process.env.FIREBASE_PRIVATE_KEY 
            ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n') 
            : undefined;

        const config = {
            credential: admin.credential.cert({
                projectId: process.env.FIREBASE_PROJECT_ID,
                clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
                privateKey: privateKey
            })
        };
        
        if (process.env.FIREBASE_PROJECT_ID) {
            config.storageBucket = `${process.env.FIREBASE_PROJECT_ID}.appspot.com`;
        }
        
        initializeApp(config);
        console.log('Firebase Admin initialized with Service Account');
    }
    
    db = getFirestore();
    storage = getStorage();
} catch (error) {
    console.error('Firebase Initialization Error:', error.message);
}

export { admin, db, storage };
