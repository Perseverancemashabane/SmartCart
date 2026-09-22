import { cartEventsBus } from '@/lib/events';

export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  { params }: { params: { cartId: string } }
) {
  const { cartId } = params;

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();

      // Send initial connection heartbeat
      const initialChunk = `data: ${JSON.stringify({ event: 'connected', cartId })}\n\n`;
      controller.enqueue(encoder.encode(initialChunk));

      // Event listener for live updates on this cartId
      const onCartUpdate = (data: any) => {
        try {
          const chunk = `data: ${JSON.stringify(data)}\n\n`;
          controller.enqueue(encoder.encode(chunk));
        } catch (err) {
          console.error('SSE Stream controller error:', err);
        }
      };

      // Subscribe to global event bus
      cartEventsBus.on(`stream:${cartId}`, onCartUpdate);

      // Cleanup listener when client disconnects
      request.signal.addEventListener('abort', () => {
        cartEventsBus.off(`stream:${cartId}`, onCartUpdate);
        controller.close();
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
