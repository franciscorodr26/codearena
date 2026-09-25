import { useEffect } from 'react';
import { useRouter } from 'next/router';
import { withAuth } from '../../components/withAuth';

function DirectChatPage() {
  const router = useRouter();
  const { userId } = router.query;

  useEffect(() => {
    if (userId) {
      // Redirect to main messages page with userId param
      router.replace(`/messages?userId=${userId}`);
    }
  }, [userId, router]);

  return null;
}

export default withAuth(DirectChatPage);
