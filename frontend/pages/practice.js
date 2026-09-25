import dynamic from 'next/dynamic'
import { useRouter } from 'next/router'
import ArenaPractice from '../components/practice/ArenaPractice'

// Practice is a warm-up surface: quick problems between battles, in the queue,
// or right after a match. Prompt practice lives on the same route under
// ?mode=prompting (next.config also redirects that to /prompt-practice).
const PromptPractice = dynamic(() => import('../components/practice/PromptPractice'))

export default function PracticePage() {
  const { query } = useRouter()
  return query.mode === 'prompting' ? <PromptPractice /> : <ArenaPractice />
}
