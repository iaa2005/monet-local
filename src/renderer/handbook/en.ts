import type { Chapter } from './types'

/**
 * The handbook, English.
 *
 * Written for a second-year undergraduate: derivatives, gradients, matrices
 * and dot products are assumed; everything else is explained. The formulae
 * are real rather than decorative — nearly every one of them is computed
 * somewhere in this program, and each topic ends by saying where.
 *
 * The first half follows the path of "The Welch Labs Illustrated Guide to
 * AI" (Stephen Welch, 2025), perceptron to attention. The words are our own,
 * and the second half is the part no book covers: what happens when a
 * trained model is run on the machine in front of you.
 */
export const HANDBOOK_EN: Chapter[] = [
  {
    id: 'basics',
    title: 'How a neural network works',
    blurb:
      'From one neuron to a deep network. No magic in it — linear algebra and a derivative.',
    topics: [
      {
        id: 'perceptron',
        title: 'The perceptron: one line of arithmetic',
        blurb: 'A weighted sum and a threshold. Everything else is built on it.',
        blocks: [
          {
            k: 'p',
            t: 'A neuron in a neural network is not biology, it is one formula. It takes an input $\\mathbf{x} \\in \\mathbb{R}^n$ — a vector of numbers — and holds learnable weights $\\mathbf{w} \\in \\mathbb{R}^n$ of the same size. It computes a dot product, adds a bias $b$, and passes the result through a function:',
          },
          {
            k: 'math',
            tex: 'y = \\varphi\\!\\left(\\mathbf{w}^{\\top}\\mathbf{x} + b\\right) = \\varphi\\!\\left(\\sum_{i=1}^{n} w_i x_i + b\\right)',
            note: "In Rosenblatt's perceptron $\\varphi$ is the sign: $+1$ or $-1$.",
          },
          {
            k: 'p',
            t: 'Geometrically $\\mathbf{w}^{\\top}\\mathbf{x} + b = 0$ is a hyperplane in $\\mathbb{R}^n$ and $\\mathbf{w}$ is its normal. The neuron answers one question: which side of the plane is this point on. Training rotates and shifts the plane until examples of different classes fall on different sides.',
          },
          {
            k: 'p',
            t: 'The learning rule is literally one line. When the model gets an example $(\\mathbf{x}, d)$ wrong, the weights move towards the right answer:',
          },
          {
            k: 'math',
            tex: '\\mathbf{w} \\leftarrow \\mathbf{w} + \\eta\\,(d - y)\\,\\mathbf{x}',
            note: '$\\eta$ is the learning rate, $d$ the wanted answer, $y$ the one obtained.',
          },
          {
            k: 'p',
            t: 'And here is the limit that nearly ended the field in the sixties: one plane cuts space in two, and exclusive-or cannot be written that way — no straight line separates two diagonal corners of a square from the other two. The answer turned out not to be a better neuron but more of them, in layers.',
          },
        ],
      },
      {
        id: 'descent',
        title: 'Gradient descent: how the weights are found',
        blurb: 'Error as a function of the weights, and a step against the gradient.',
        blocks: [
          {
            k: 'p',
            t: "The perceptron rule only works when the classes are linearly separable. The general method is to turn \"is wrong\" into a number and minimise it. For a set of examples $\\{(\\mathbf{x}_j, d_j)\\}$, take a loss — mean squared error, say:",
          },
          {
            k: 'math',
            tex: 'L(\\mathbf{w}) = \\frac{1}{2m}\\sum_{j=1}^{m}\\bigl(f(\\mathbf{x}_j;\\mathbf{w}) - d_j\\bigr)^2',
          },
          {
            k: 'p',
            t: 'Now $L$ is an ordinary function of many variables and the weights are its arguments. The gradient $\\nabla L$ points the way of steepest increase, so against it is steepest decrease. One step:',
          },
          {
            k: 'math',
            tex: '\\mathbf{w} \\leftarrow \\mathbf{w} - \\eta\\,\\nabla L(\\mathbf{w})',
          },
          {
            k: 'p',
            t: 'Two facts make this practical. First, computing the gradient over all $m$ examples is expensive, so a random subset (a mini-batch) is used instead: the estimate is noisy but unbiased, and a noisy estimate is orders of magnitude cheaper than an exact one. That is stochastic gradient descent.',
          },
          {
            k: 'p',
            t: 'Second, $L$ for a deep network is not convex and nobody guarantees the global minimum. In practice this matters far less than it sounds: in a space of millions of dimensions the overwhelming majority of critical points are saddles rather than local minima, and the minima that are found are about equally good.',
          },
          {
            k: 'p',
            t: 'The learning rate $\\eta$ is the one genuinely temperamental knob. Too small and training does not converge in any reasonable time; too large and the steps overshoot and the loss diverges.',
          },
        ],
      },
      {
        id: 'backprop',
        title: 'Backpropagation: the chain rule',
        blurb: 'Why a gradient over a billion weights costs one backward pass.',
        blocks: [
          {
            k: 'p',
            t: 'A descent step needs $\\partial L / \\partial w$ for every weight. Computing them one at a time numerically is $2N$ runs of the network for $N$ weights; at $N \\sim 10^9$ that is not a plan. Backpropagation produces all of them at once, in a single backward pass costing about as much as one forward pass.',
          },
          {
            k: 'p',
            t: 'The chain rule is the whole of it. A network of layers is a composition of functions, and the derivative of a composition is a product of derivatives. Write the input of layer $l$ as $a^{(l-1)}$ and its output as',
          },
          {
            k: 'math',
            tex: 'z^{(l)} = W^{(l)}a^{(l-1)} + b^{(l)}, \\qquad a^{(l)} = \\varphi\\!\\left(z^{(l)}\\right)',
          },
          {
            k: 'p',
            t: 'Let $\\delta^{(l)} = \\partial L / \\partial z^{(l)}$ — how sensitive the loss is to the input of the nonlinearity at layer $l$. Everything then follows from the next layer:',
          },
          {
            k: 'math',
            tex: '\\delta^{(l)} = \\left(W^{(l+1)\\top}\\delta^{(l+1)}\\right) \\odot \\varphi^{\\prime}\\!\\left(z^{(l)}\\right), \\qquad \\frac{\\partial L}{\\partial W^{(l)}} = \\delta^{(l)} a^{(l-1)\\top}',
            note: '$\\odot$ is element-wise multiplication.',
          },
          {
            k: 'p',
            t: 'It is a recurrence: knowing $\\delta$ at the output, walk backwards layer by layer. Each step is a multiplication by a transposed weight matrix — the same cost as going forward. Hence the rule of thumb that training costs roughly three times inference: forward, backward, update.',
          },
          {
            k: 'app',
            t: 'All of this is training. Monet Local does not train: the model is already trained, and only the forward pass runs on your machine. That is why memory here goes to weights and cache rather than to gradients and optimiser state, which during training would take three times as much again.',
          },
        ],
      },
      {
        id: 'depth',
        title: 'Why layers, and why a bend',
        blurb: 'Why two linear layers are one, and what the nonlinearity buys.',
        blocks: [
          {
            k: 'p',
            t: 'Remove $\\varphi$ and the layers collapse: $W_2(W_1\\mathbf{x}) = (W_2W_1)\\mathbf{x}$ — a product of matrices is a matrix. However many linear layers you stack, you get one linear map. The nonlinearity between them is the only thing that makes depth mean anything.',
          },
          {
            k: 'p',
            t: "Today's standard is almost embarrassingly simple: ReLU, $\\varphi(z) = \\max(0, z)$, and its smoothed relatives (GELU, SiLU). Each ReLU neuron splits space in half and zeroes one side; a network of them carves the input into many regions and behaves linearly on each. A piecewise-linear function with enough pieces approximates anything.",
          },
          {
            k: 'p',
            t: 'The universal approximation theorem says one hidden layer is enough — but it says nothing about how wide, and the required width grows exponentially. Depth buys the same approximation with a polynomial number of parameters: each layer works not on the raw coordinates but on features the previous one built.',
          },
          {
            k: 'p',
            t: 'The price of depth is the vanishing gradient: backpropagation multiplies derivatives, and thirty numbers below one multiplied together are zero. Residual connections, $a^{(l)} = a^{(l-1)} + F(a^{(l-1)})$, fix it by giving the gradient a straight road back — the derivative of a sum contains a $1$, which does not decay. That is why every transformer block adds its input back.',
          },
        ],
      },
    ],
  },

  {
    id: 'llm',
    title: 'The language model',
    blurb:
      'What the model actually predicts, and what attention is — the mechanism the rest hangs on.',
    topics: [
      {
        id: 'tokens',
        title: 'Tokens and embeddings',
        blurb: 'How text becomes numbers, and why the counting is not in letters.',
        blocks: [
          {
            k: 'p',
            t: 'The model never sees letters. Text is split into tokens — word pieces from a vocabulary of 32,000 to 256,000 entries, built in advance. Common words are one token; rare ones break into several. As a rule of thumb one token is about four characters of English, and closer to two or three of Russian, which is worse represented in most vocabularies.',
          },
          {
            k: 'p',
            t: 'Each token is an index into an embedding table $E \\in \\mathbb{R}^{V \\times d}$, where $V$ is the vocabulary size and $d$ the model dimension (typically 2048–8192). The row is the vector the network works with. These vectors are learned along with everything else, and structure appears in them: directions in the space come to correspond to meanings.',
          },
          {
            k: 'p',
            t: 'A dot product knows nothing about order, so position is added separately. Modern models use RoPE, which rotates pairs of coordinates by an angle proportional to the position. The dot product of two vectors then depends only on the difference of their positions — which is what is wanted: "two words earlier" is a relation, not an address.',
          },
          {
            k: 'app',
            t: 'Vocabulary size and model dimension come out of the GGUF header, and together with the layer count they are what Monet Local costs a context from. The context length on the Server screen is in tokens, not characters — hence the gap between 8192 tokens and "about 30,000 characters of English".',
          },
        ],
      },
      {
        id: 'attention',
        title: 'Attention',
        blurb: 'Q, K, V and a softmax — the mechanism that replaced recurrent networks.',
        blocks: [
          {
            k: 'p',
            t: 'The problem: while processing a token, pull in whatever earlier tokens are relevant to it. Which ones are relevant is not known in advance and depends on the content — in "the cat that she fed yesterday is asleep", "asleep" must look at "cat", not at "yesterday".',
          },
          {
            k: 'p',
            t: 'Attention solves it as a lookup by content. Three learned matrices turn each vector into three: a query $Q = XW_Q$ (what I am looking for), a key $K = XW_K$ (what I am), and a value $V = XW_V$ (what I hand over if chosen). How well a query matches a key is a dot product:',
          },
          {
            k: 'math',
            tex: '\\operatorname{Attention}(Q,K,V) = \\operatorname{softmax}\\!\\left(\\frac{QK^{\\top}}{\\sqrt{d_k}}\\right)V',
          },
          {
            k: 'p',
            t: 'The softmax turns a row of numbers into a distribution — weights that are positive and sum to one:',
          },
          {
            k: 'math',
            tex: '\\operatorname{softmax}(z)_i = \\frac{e^{z_i}}{\\sum_j e^{z_j}}',
          },
          {
            k: 'p',
            t: 'Dividing by $\\sqrt{d_k}$ is not cosmetic. The dot product of two random vectors of dimension $d_k$ has variance of order $d_k$; without the scaling, at $d_k = 128$ the softmax inputs spread far enough that the distribution collapses onto a single element and the gradient through it goes to zero.',
          },
          {
            k: 'p',
            t: 'In a language model attention is causal: a token may only see earlier ones. That is done with a mask — entries of $QK^\\top$ above the diagonal are set to $-\\infty$, so the softmax makes them exactly zero. There are several heads (typically 8–64), each with its own $W_Q, W_K, W_V$: one tracks agreement, another syntax, another repetition.',
          },
          {
            k: 'app',
            t: 'The $K$ and $V$ of every earlier token are exactly what the KV cache holds — recomputing them each step would be quadratic in length. That is the memory the Server screen labels "KV cache", and at long contexts it costs more than the weights.',
          },
        ],
      },
      {
        id: 'transformer',
        title: 'The block, and the next token',
        blurb: 'What a layer is made of, and what the model actually outputs.',
        blocks: [
          {
            k: 'p',
            t: 'A transformer block has two halves, each wrapped in a residual connection with a normalisation:',
          },
          {
            k: 'math',
            tex: '\\begin{aligned} h &= x + \\operatorname{Attention}(\\operatorname{norm}(x)) \\\\ y &= h + \\operatorname{FFN}(\\operatorname{norm}(h)) \\end{aligned}',
          },
          {
            k: 'p',
            t: 'Attention mixes information between positions; the FFN — an ordinary two-layer network applied to each position separately — works on what attention brought. The FFN usually widens the dimension fourfold and narrows it back, and it accounts for roughly two thirds of all the weights in the model.',
          },
          {
            k: 'p',
            t: 'Between 30 and 100 such blocks are stacked. At the end, the vector at each position is multiplied by a $d \\times V$ matrix into logits — one number per token in the vocabulary. A softmax over the logits is the model\'s answer:',
          },
          {
            k: 'math',
            tex: 'p(x_t \\mid x_1, \\dots, x_{t-1}) = \\operatorname{softmax}(z_t)',
            note: 'Everything the model does is produce a distribution over the next token.',
          },
          {
            k: 'p',
            t: 'It is worth pausing on that. The model does not "know the answer" or "plan the sentence". It emits a distribution over the next token, one is drawn from it, appended to the input, and the whole thing runs again. Conversation, reasoning, code — all of it is that one operation repeated.',
          },
          {
            k: 'p',
            t: 'From which follows the fact that matters most in practice: reading your question and writing the answer are fundamentally different in cost. The question is known in full, so all its tokens are computed in parallel. The answer has to be built one token per pass, because the next one depends on the last.',
          },
        ],
      },
      {
        id: 'moe',
        title: 'Mixture of experts',
        blurb: 'Why a 27-billion model can compute like a 3-billion one.',
        blocks: [
          {
            k: 'p',
            t: 'In an ordinary ("dense") model every token passes through every weight. A mixture of experts replaces one FFN with $N$ parallel FFNs — experts — plus a small learned router that picks $k$ of them per token, usually 2 of 8 or 8 of 128.',
          },
          {
            k: 'math',
            tex: 'y = \\sum_{i \\in \\operatorname{top}_k(g(x))} g_i(x)\\, \\operatorname{FFN}_i(x)',
            note: '$g$ is the router and $g_i$ the weight of the chosen expert.',
          },
          {
            k: 'p',
            t: 'This separates two quantities that were the same thing in a dense model: total parameters and parameters active per token. A model can hold 27 billion weights and compute like a three-billion one. Quality tracks the total; compute cost tracks the active count.',
          },
          {
            k: 'p',
            t: 'For running one at home that is an awkward asymmetry: every expert has to be resident, because the router may pick any of them, while the arithmetic is cheap. A MoE model takes the memory of a large model and the compute of a small one — exactly the wrong way round for a laptop.',
          },
          {
            k: 'app',
            t: 'Monet Local marks these with a MoE badge, decided both by the `expert_count` header field and by the presence of `ffn_*_exps` tensors. On the Benchmark screen the memory-bandwidth ceiling is marked as not applying to them: it is computed from the whole file, while only part of it is read per token, so the measurement rightly beats it.',
          },
        ],
      },
    ],
  },

  {
    id: 'memory',
    title: 'What takes the memory',
    blurb:
      'Three costs and two ceilings. Every formula behind the verdict this program gives lives here.',
    topics: [
      {
        id: 'weights',
        title: 'Weights and quantisation',
        blurb: 'Where Q4_K_M comes from, and what it costs per parameter.',
        blocks: [
          {
            k: 'p',
            t: 'A trained model is a pile of matrices. At its native bfloat16, a model of $P$ parameters takes $2P$ bytes: 27 billion parameters is 54 gigabytes. That does not fit in 32 GB of RAM, which is where quantisation comes in.',
          },
          {
            k: 'p',
            t: 'The idea is simple. Weights within a small block (usually 32 of them) are similar in magnitude. Store them not individually but through a shared scale: take the largest absolute value, divide by it, round to a few bits, and keep the integers plus one scale per block.',
          },
          {
            k: 'math',
            tex: 's = \\frac{\\max_i |w_i|}{2^{b-1}-1}, \\qquad q_i = \\operatorname{round}\\!\\left(\\frac{w_i}{s}\\right), \\qquad \\hat{w}_i = s\\,q_i',
            note: '$b$ is bits per weight; the scale $s$ is stored as f16.',
          },
          {
            k: 'p',
            t: 'Hence the fractional bits-per-weight: `Q4_0` is 32 weights at 4 bits plus a two-byte scale, $(16 + 2)/32 \\cdot 8 = 4.5$ bits. The letters name the scheme: `K` means a two-level scale per block, `_M` and `_S` are the medium and small variants, `IQ` is a codebook scheme, and `UD` is the prefix on Unsloth builds that mix precision by layer.',
          },
          {
            k: 'table',
            head: ['Quant', '≈ bits/weight', '27B ≈', 'Notes'],
            rows: [
              ['BF16', '16', '54 GiB', 'native precision'],
              ['Q8_0', '8.5', '29 GiB', 'losses not measurable'],
              ['Q6_K', '6.6', '22 GiB', 'effectively lossless'],
              ['Q4_K_M', '4.8', '16 GiB', 'the usual working choice'],
              ['IQ4_XS', '4.25', '14 GiB', 'denser at similar quality'],
              ['Q3_K_M', '3.9', '13 GiB', 'losses are noticeable'],
            ],
          },
          {
            k: 'p',
            t: 'Below four bits quality falls quickly and non-linearly. The general rule, and it holds up under measurement: a bigger model at a smaller quant beats a smaller model at a bigger one — 27B at Q4 is stronger than 8B at Q8 for about the same memory.',
          },
          {
            k: 'app',
            t: 'The file size is the weight size — Monet Local reads it from the filesystem rather than estimating it. It sits next to the quant on the Models screen, and it is the "Weights" line in the verdict.',
          },
        ],
      },
      {
        id: 'kv',
        title: 'The KV cache, and what context costs',
        blurb: 'The formula this program exists for.',
        blocks: [
          {
            k: 'p',
            t: 'So that attention need not be recomputed over the whole history at every step, the keys and values of all past tokens are kept in memory. This cache grows linearly with the context length, and at long contexts it is larger than the weights themselves.',
          },
          {
            k: 'p',
            t: 'Per token it holds two vectors, K and V, for every head, in every attention layer:',
          },
          {
            k: 'math',
            tex: '\\text{bytes/token} = L_{\\text{attn}} \\cdot n_{kv}\\,\\bigl(d_k \\cdot b_K + d_v \\cdot b_V\\bigr)',
            note: '$L_{\\text{attn}}$ attention layers, $n_{kv}$ key/value heads, $d_k, d_v$ their dimensions, $b_K, b_V$ bytes per cached element.',
          },
          {
            k: 'p',
            t: 'Take Qwen3.8-27B: 65 blocks, but the model is hybrid — only every fourth block is full attention, and the other 49 carry a fixed-size recurrent state that does not grow with context. So $L_{\\text{attn}} = \\lfloor 65/4 \\rfloor = 16$, with $n_{kv} = 4$, $d_k = d_v = 256$ and f16:',
          },
          {
            k: 'math',
            tex: '16 \\cdot 4 \\cdot (256 \\cdot 2 + 256 \\cdot 2) = 65\\,536 \\text{ bytes} = 64\\text{ KiB per token}',
          },
          {
            k: 'p',
            t: 'At the advertised maximum of 262,144 tokens that is $64 \\text{ KiB} \\cdot 262144 = 16$ GiB of cache, on top of sixteen gigabytes of weights. Which is why the context slider in this program sits next to a memory estimate rather than on its own.',
          },
          {
            k: 'p',
            t: 'There are two ways to shrink it. Quantise it: `--cache-type-k q8_0 --cache-type-v q4_0` brings $b_K$ to 1.06 and $b_V$ to 0.56 bytes per element, roughly a quarter of the size. Or keep it off the GPU (`--no-kv-offload`): the same bytes, but in system RAM, where there is more of it.',
          },
          {
            k: 'app',
            t: 'Both flags are in the configuration, and the verdict recomputes on every change. Ignore the hybrid structure and count all 65 layers, and the estimate overstates the cache fourfold and refuses configurations that run perfectly well — which is why the program reads `full_attention_interval` out of the header.',
          },
        ],
      },
      {
        id: 'ceilings',
        title: 'Two ceilings: RAM and the GPU',
        blurb: '"Fits in memory" and "fits on the card" are different questions.',
        blocks: [
          {
            k: 'p',
            t: 'A configuration has to clear two independent checks, and the second is usually the tighter one.',
          },
          { k: 'h', t: 'System RAM' },
          {
            k: 'p',
            t: 'The total is weights plus cache plus compute buffers. The buffers scale with the physical batch — roughly $0.35 + 0.25 \\cdot \\text{ubatch}/256$ gigabytes. From the machine total, subtract about 3 GiB for the operating system and whatever else is running.',
          },
          {
            k: 'math',
            tex: 'W + KV + C \\;\\le\\; R_{\\text{total}} - 3\\,\\text{GiB}',
          },
          { k: 'h', t: 'The GPU' },
          {
            k: 'p',
            t: 'This is not the same sum against a different number. The device holds the weight file itself, not its repacked copy; but the cache there costs more than its nominal size, because llama.cpp allocates it per layer and keeps a graph workspace addressing it. The factor 1.7 is fitted to where it actually breaks: 8192 loads, 16384 dies on a 549 MB allocation, and 32768 loads again the moment the cache moves off the card.',
          },
          {
            k: 'math',
            tex: 'W_{\\text{file}} + 1.7 \\cdot KV_{\\text{on device}} + C \\;\\le\\; V_{\\text{allocator}}',
          },
          {
            k: 'p',
            t: 'Integrated graphics is the trap. A Radeon 780M has no memory of its own: its "VRAM" is a slice of the same system RAM. A gigabyte given to the GPU is a gigabyte taken from the system, not extra capacity — and its ceiling is still its own, and usually lower.',
          },
          {
            k: 'app',
            t: 'The Server screen draws two meters, not one. A "will not fit" verdict above a comfortable-looking RAM bar means exactly that: RAM had room, and the refusal came from the second ceiling. The UMA badge beside the memory figure means the memory is shared.',
          },
          {
            k: 'p',
            t: 'One more cost is easy to miss: repacking. By default llama.cpp rearranges quantised weights into a SIMD-friendly layout and keeps a second copy — about $+30\\%$ on the weights. On a machine with no headroom that is the difference between running and swapping, which is why `--no-repack` is on by default here.',
          },
        ],
      },
    ],
  },

  {
    id: 'speed',
    title: 'What decides the speed',
    blurb:
      'Why a local model is limited by memory rather than by the processor, and what follows from that.',
    topics: [
      {
        id: 'bandwidth',
        title: 'Memory bandwidth is the whole ceiling',
        blurb: 'An estimate of the speed from first principles, before running anything.',
        blocks: [
          {
            k: 'p',
            t: 'To emit one token, a dense model must read all of its weights — each exactly once. There is very little arithmetic per byte read, about two operations. So the bottleneck is not the processor, it is the memory bus.',
          },
          {
            k: 'math',
            tex: 't_{\\max} = \\frac{B}{S}',
            note: '$B$ is memory bandwidth in bytes per second, $S$ the size of the weights in bytes.',
          },
          {
            k: 'p',
            t: 'Dual-channel DDR5-5600 gives $2 \\cdot 8 \\cdot 5.6 \\cdot 10^9 \\approx 89.6$ GB/s. For a 16 GiB model that is $89.6 / 17.2 \\approx 5.2$ tokens per second at the theoretical limit. The 4.31 tokens per second measured on this machine is 83% of it — meaning there is nothing left to gain from settings.',
          },
          {
            k: 'p',
            t: 'The consequence is worth learning before anything else: more RAM buys capacity, not speed. Speed comes only from smaller weights — a smaller quant or a smaller model. Going from 32 to 64 gigabytes will let you run a longer context; it will not add tokens per second.',
          },
          {
            k: 'p',
            t: 'A GPU has a much wider bus — 200 GB/s on a modest discrete card, up to 1000 on a large one. But integrated graphics shares the processor\'s bus, so on machines like this the gain is modest and comes mostly from prompt processing.',
          },
          {
            k: 'app',
            t: 'The Benchmark screen shows this ceiling next to the measurement. Generation close to it means you have hit the hardware and the configuration is not the problem. For MoE models the tile marks the figure as not applying: only part of the weights is active.',
          },
        ],
      },
      {
        id: 'prompt-vs-gen',
        title: 'Reading and writing are different speeds',
        blurb: 'Why the first answer is slow and the next ones are quick.',
        blocks: [
          {
            k: 'p',
            t: 'Every measurement has two numbers, and it is worth not confusing them.',
          },
          {
            k: 'p',
            t: 'Prompt processing: all the tokens of the question are known at once and computed in parallel, one matrix multiplication over the whole batch. The weights are read once for the batch rather than once per token, so the limit is arithmetic and the speed is in the hundreds of tokens per second.',
          },
          {
            k: 'p',
            t: 'Generation: one token per pass, because the next depends on the last. The weights are read again for every token, the limit is bandwidth, and the speed is in single digits. A fifty-fold gap between the two numbers is normal.',
          },
          {
            k: 'p',
            t: 'This is also the familiar "slow the first time, quick after": the first request computes the whole context, the next one computes only what is new, because the KV cache of the earlier tokens is already in memory. That is its second job, beyond avoiding the quadratic cost.',
          },
          {
            k: 'p',
            t: 'Speculative decoding tries to break the sequential nature of generation: a small fast model proposes several tokens ahead and the large one checks them in a single parallel pass. Matching tokens are accepted; the first mismatch and everything after it is thrown away. It pays off when the small model guesses often — on predictable text such as code.',
          },
        ],
      },
      {
        id: 'batches',
        title: 'Batches, threads and layers on the card',
        blurb: 'Three settings that trade memory against speed.',
        blocks: [
          { k: 'h', t: 'Batch and physical batch' },
          {
            k: 'p',
            t: '`--batch-size` is how many prompt tokens go into one logical step; `--ubatch-size` is how many of those are computed at once physically. The compute buffer scales with the physical one, so lowering `ubatch` is the cheapest way to claw back device memory, at some cost to prompt speed. It does not affect generation: there is only one token there anyway.',
          },
          { k: 'h', t: 'Threads' },
          {
            k: 'p',
            t: 'The right answer is the number of physical cores, not logical ones. Hyper-threading shares the same execution units and cache between two threads, and this workload is memory-bound: two threads per core fight over the same bus and usually cost more than they add.',
          },
          { k: 'h', t: 'Layers on the GPU' },
          {
            k: 'p',
            t: 'A model can be split: the card computes some layers, the processor the rest. Total time is the sum, so the gain is roughly proportional to the share that lands on the faster device. Leaving the field empty means "llama.cpp will decide", which is almost always better than a hand-set number: a number set by hand that does not fit makes the server refuse to start rather than fall back to the CPU.',
          },
          { k: 'h', t: 'Concurrent requests' },
          {
            k: 'p',
            t: '`--parallel` sets the number of slots, and the important detail is that the context is divided between them. Four slots on a 262144 context give each conversation 65536, while the memory bill stays at the full number. For working alone, 1 is the right answer.',
          },
          {
            k: 'app',
            t: 'All of these are sliders in the configuration, and each one recomputes the verdict as it moves. Settings are fixed when a model is loaded, so a change takes effect on the Apply button, which restarts the server and loads the same models again.',
          },
        ],
      },
    ],
  },

  {
    id: 'tuning',
    title: 'Tuning',
    blurb: 'What to do with the knobs — from picking a token to a finished configuration.',
    topics: [
      {
        id: 'sampling',
        title: 'Sampling: temperature, top-k, top-p',
        blurb: 'The model gave a distribution — how a token is drawn from it.',
        blocks: [
          {
            k: 'p',
            t: 'The model outputs a probability for every token in the vocabulary. Always taking the most likely one (greedy decoding) works, but the text comes out flat and prone to looping. So a token is drawn at random, from a distribution that has been reshaped first.',
          },
          {
            k: 'p',
            t: 'Temperature scales the logits before the softmax:',
          },
          {
            k: 'math',
            tex: 'p_i = \\frac{\\exp(z_i / T)}{\\sum_j \\exp(z_j / T)}',
          },
          {
            k: 'p',
            t: 'As $T \\to 0$ the distribution collapses to greedy; at $T = 1$ it is untouched; above 1 it flattens and unlikely tokens come into play. For code and factual answers 0.1–0.4; for free text 0.7–1.0.',
          },
          {
            k: 'p',
            t: 'Top-k keeps the $k$ most likely tokens and zeroes the rest. Top-p (nucleus sampling) is more adaptive: it takes the smallest set of tokens whose probabilities reach $p$. On a confident step that may be two tokens; on an uncertain one, a hundred. Usually $p = 0.9\\text{–}0.95$.',
          },
          {
            k: 'app',
            t: 'The temperature and top-p fields in the configuration are empty by default, and empty is not zero — it is "use the model\'s own recommendation". Authors put it in the GGUF and it is almost always better than an arbitrary number. Override only if you know the particular model.',
          },
        ],
      },
      {
        id: 'recipe',
        title: 'Putting a configuration together',
        blurb: 'An order of operations rather than a list of recommendations.',
        blocks: [
          {
            k: 'p',
            t: 'The order matters more than the values: each step settles a question that would otherwise spoil the next.',
          },
          { k: 'h', t: '1. Pick the quant from the memory you have' },
          {
            k: 'p',
            t: 'The weights should take about half of what is available — the other half goes to cache and buffers. On 32 GiB that is a 14–17 GiB model, so a 27B at Q4_K_M or IQ4_XS. When choosing: a bigger model at a smaller quant beats a smaller one at a bigger quant.',
          },
          { k: 'h', t: '2. Turn repacking off' },
          {
            k: 'p',
            t: '`--no-repack` is on by default here. Thirty percent on top of the weights is what turns a working configuration into continuous swapping. Turn it back on only when memory is plainly abundant.',
          },
          { k: 'h', t: '3. Start from an honest context' },
          {
            k: 'p',
            t: 'Not from the advertised maximum. Take 8192 and look at the verdict: it will show what the cache cost. Then raise it until both meters approach their limits. An advertised 262144 almost always means "the model can do this", not "your machine can".',
          },
          { k: 'h', t: '4. If the GPU is the wall, take the cache off it' },
          {
            k: 'p',
            t: 'A refusal from the second ceiling with RAM to spare is cured by `--no-kv-offload`: the cache moves to system memory and the weights stay on the card. On this machine that is exactly how a 32768 context ran where 16384 had died.',
          },
          { k: 'h', t: '5. Quantise the cache if the context still will not fit' },
          {
            k: 'p',
            t: '`-ctk q8_0 -ctv q4_0` with flash attention on brings the cache to roughly a quarter. Quality suffers little — values tolerate coarse rounding better than keys do, which is why they get fewer bits.',
          },
          { k: 'h', t: '6. Threads to the physical core count' },
          {
            k: 'p',
            t: 'Not the logical one. If unsure, half of what the system reports.',
          },
          { k: 'h', t: '7. Measure' },
          {
            k: 'p',
            t: 'The Benchmark screen gives two numbers and the bandwidth ceiling. If generation is near the ceiling there is nothing left to tune — that is the hardware. If it is far below, something is wrong: check for swapping, for repacking, and for a second server running over the same weights.',
          },
          {
            k: 'app',
            t: 'A configuration belongs to a model — to the file, so each quant has its own. That is right: Q4 and Q6 of one model fit into memory differently, and shared settings for both would be a compromise in favour of the worse case.',
          },
        ],
      },
      {
        id: 'further',
        title: 'Where to read further',
        blurb: 'The sources this handbook leans on.',
        blocks: [
          {
            k: 'p',
            t: 'This is a short account of things other people give chapters to. If you want the depth:',
          },
          {
            k: 'ul',
            items: [
              '**The Welch Labs Illustrated Guide to AI**, Stephen Welch, 2025 — perceptron to attention, illustrated, with exercises. The first half of this handbook follows its path.',
              '**Attention Is All You Need**, Vaswani et al., 2017 — the paper that introduced the transformer. Eight pages, nearly all of which still hold.',
              '**The Illustrated Transformer**, Jay Alammar — attention step by step, if the formulae above were too dense.',
              '**llama.cpp itself** — `llama-server --help` on the installed runtime is exhaustive and, unlike any article, correct for your build.',
            ],
          },
          {
            k: 'p',
            t: 'And a practical note to end on: the numbers in this handbook come from one machine (Ryzen 7840HS, 2×16 GB DDR5-5600, Radeon 780M). The formulae travel anywhere; the measurements do not. Measure your own.',
          },
        ],
      },
    ],
  },
]
