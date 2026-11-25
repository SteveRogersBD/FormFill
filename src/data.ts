import { getFirebaseServices } from './firebase';
import { resumeProfileSchema, type ResumeProfile } from './profile';
import { preferencesSchema, type Preferences } from './preferences';
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
  const [{ doc, setDoc }, { deleteObject, ref, uploadBytes }] = await Promise.all([import('firebase/firestore'), import('firebase/storage')]);
  const safeName = file.name.replace(/[^\w.-]/g, '_');
  const path = `resumes/${uid}/${Date.now()}-${safeName}`;
  const savedProfile = resumeProfileSchema.parse({ ...profile, resumePath: path, updatedAt: Date.now() });
  const newResume = ref(storage, path);
  await uploadBytes(newResume, file, { contentType: 'application/pdf' });
  try {
    await setDoc(doc(db, 'users', uid, 'profile', 'current'), savedProfile);
  } catch (error) {
    await deleteObject(newResume).catch(() => undefined);
    throw error;
  }
  if (profile.resumePath && profile.resumePath !== path) {
    await deleteObject(ref(storage, profile.resumePath)).catch(() => undefined);
  }
  return savedProfile;
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

// Download in the extension, which has Storage host permission. A content script's
// fetch runs under the application site's cross-origin restrictions.
export async function getResumeAttachment(path: string) {
  const response = await fetch(await getResumeUrl(path));
  if (!response.ok) throw new Error('Could not download your saved resume. Open your profile and check the saved PDF.');
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!bytes.length || bytes.length > 10 * 1024 * 1024) throw new Error('The saved resume is empty or exceeds 10 MB.');
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 32768) binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
  return { data: btoa(binary), name: path.split('/').pop() || 'resume.pdf' };
}

export async function loadPreferences(uid: string): Promise<Preferences | null> {
  const { db } = await getFirebaseServices();
  const { doc, getDoc } = await import('firebase/firestore');
  const snapshot = await getDoc(doc(db, 'users', uid, 'preferences', 'current'));
  return snapshot.exists() ? preferencesSchema.parse(snapshot.data()) : null;
}

export async function savePreferences(preferences: Preferences, uid: string) {
  const { db } = await getFirebaseServices();
  const { doc, setDoc } = await import('firebase/firestore');
  const savedPreferences = preferencesSchema.parse({ ...preferences, updatedAt: Date.now() });
  try {
    await setDoc(doc(db, 'users', uid, 'preferences', 'current'), savedPreferences);
  } catch (reason) {
    if (reason && typeof reason === 'object' && 'code' in reason && reason.code === 'permission-denied') {
      throw new Error('Your Equal Employment answers were not saved because Firebase denied the write. Update the Firestore rules for this app, then retry.', { cause: reason });
    }
    throw reason;
  }
  return savedPreferences;
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

