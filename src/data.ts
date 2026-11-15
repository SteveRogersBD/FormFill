import { addDoc, collection, deleteDoc, doc, getDoc, getDocs, orderBy, query, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { getFirebaseServices } from './firebase';
import type { ResumeProfile } from './profile';

export interface ApplicationRecord {
  id: string;
  company: string;
  role: string;
  url: string;
  status: 'submitted' | 'in_progress' | 'interview' | 'rejected' | 'offer';
  createdAt?: number;
}

export async function saveResume(file: File, profile: ResumeProfile, uid: string) {
  const { db, storage } = await getFirebaseServices();
  const safeName = file.name.replace(/[^\w.-]/g, '_');
  const path = `resumes/${uid}/${Date.now()}-${safeName}`;
  await uploadBytes(ref(storage, path), file, { contentType: 'application/pdf' });
  const savedProfile = { ...profile, resumePath: path, updatedAt: Date.now() };
  await setDoc(doc(db, 'users', uid, 'profile', 'current'), savedProfile);
  return { profile: savedProfile, downloadUrl: await getDownloadURL(ref(storage, path)) };
}

export async function saveProfile(profile: ResumeProfile, uid: string) {
  const { db } = await getFirebaseServices();
  const savedProfile = { ...profile, updatedAt: Date.now() };
  await setDoc(doc(db, 'users', uid, 'profile', 'current'), savedProfile);
  return savedProfile;
}

export async function loadProfile(uid: string): Promise<ResumeProfile | null> {
  const { db } = await getFirebaseServices();
  const snapshot = await getDoc(doc(db, 'users', uid, 'profile', 'current'));
  return snapshot.exists() ? snapshot.data() as ResumeProfile : null;
}

export async function getResumeUrl(path: string) {
  const { storage } = await getFirebaseServices();
  return getDownloadURL(ref(storage, path));
}

export async function listApplications(uid: string): Promise<ApplicationRecord[]> {
  const { db } = await getFirebaseServices();
  const records = await getDocs(query(collection(db, 'users', uid, 'applications'), orderBy('createdAt', 'desc')));
  return records.docs.map((record) => ({ id: record.id, ...record.data() } as ApplicationRecord));
}

export async function saveApplication(uid: string, input: Omit<ApplicationRecord, 'id' | 'createdAt'>) {
  const { db } = await getFirebaseServices();
  await addDoc(collection(db, 'users', uid, 'applications'), { ...input, createdAt: Date.now(), serverCreatedAt: serverTimestamp() });
}

export async function updateApplication(uid: string, id: string, status: ApplicationRecord['status']) {
  const { db } = await getFirebaseServices();
  await updateDoc(doc(db, 'users', uid, 'applications', id), { status });
}

export async function deleteApplication(uid: string, id: string) {
  const { db } = await getFirebaseServices();
  await deleteDoc(doc(db, 'users', uid, 'applications', id));
}

