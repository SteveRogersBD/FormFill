import { getFirebaseServices } from './firebase';
import { resumeProfileSchema, type ResumeProfile } from './profile';
import { z } from 'zod';

const applicationSchema = z.object({
  company: z.string().max(200),
  role: z.string().max(300),
  url: z.string().url(),
  status: z.enum(['submitted', 'in_progress', 'interview', 'rejected', 'offer']),
  createdAt: z.number().optional(),
});

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
  const [{ doc, setDoc }, { getDownloadURL, ref, uploadBytes }] = await Promise.all([import('firebase/firestore'), import('firebase/storage')]);
  const safeName = file.name.replace(/[^\w.-]/g, '_');
  const path = `resumes/${uid}/${Date.now()}-${safeName}`;
  await uploadBytes(ref(storage, path), file, { contentType: 'application/pdf' });
  const savedProfile = resumeProfileSchema.parse({ ...profile, resumePath: path, updatedAt: Date.now() });
  await setDoc(doc(db, 'users', uid, 'profile', 'current'), savedProfile);
  return { profile: savedProfile, downloadUrl: await getDownloadURL(ref(storage, path)) };
}

export async function saveProfile(profile: ResumeProfile, uid: string) {
  const { db } = await getFirebaseServices();
  const { doc, setDoc } = await import('firebase/firestore');
  const savedProfile = resumeProfileSchema.parse({ ...profile, updatedAt: Date.now() });
  await setDoc(doc(db, 'users', uid, 'profile', 'current'), savedProfile);
  return savedProfile;
}

export async function loadProfile(uid: string): Promise<ResumeProfile | null> {
  const { db } = await getFirebaseServices();
  const { doc, getDoc } = await import('firebase/firestore');
  const snapshot = await getDoc(doc(db, 'users', uid, 'profile', 'current'));
  return snapshot.exists() ? resumeProfileSchema.parse(snapshot.data()) : null;
}

export async function getResumeUrl(path: string) {
  const { storage } = await getFirebaseServices();
  const { getDownloadURL, ref } = await import('firebase/storage');
  return getDownloadURL(ref(storage, path));
}

export async function listApplications(uid: string): Promise<ApplicationRecord[]> {
  const { db } = await getFirebaseServices();
  const { collection, getDocs, orderBy, query } = await import('firebase/firestore');
  const records = await getDocs(query(collection(db, 'users', uid, 'applications'), orderBy('createdAt', 'desc')));
  return records.docs.map((record) => ({ id: record.id, ...applicationSchema.parse(record.data()) }));
}

export async function saveApplication(uid: string, input: Omit<ApplicationRecord, 'id' | 'createdAt'>) {
  const { db } = await getFirebaseServices();
  const { addDoc, collection, serverTimestamp } = await import('firebase/firestore');
  await addDoc(collection(db, 'users', uid, 'applications'), { ...input, createdAt: Date.now(), serverCreatedAt: serverTimestamp() });
}

export async function updateApplication(uid: string, id: string, status: ApplicationRecord['status']) {
  const { db } = await getFirebaseServices();
  const { doc, updateDoc } = await import('firebase/firestore');
  await updateDoc(doc(db, 'users', uid, 'applications', id), { status });
}

export async function deleteApplication(uid: string, id: string) {
  const { db } = await getFirebaseServices();
  const { deleteDoc, doc } = await import('firebase/firestore');
  await deleteDoc(doc(db, 'users', uid, 'applications', id));
}

