export default async (req, context) => {
    try {
        const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
        if (!stripeSecretKey) {
            throw new Error("Missing STRIPE_SECRET_KEY");
        }

        // Dynamic import to safely handle module loading
        const { default: Stripe } = await import('stripe');
        const stripe = new Stripe(stripeSecretKey);

        if (req.method !== 'POST') {
            return new Response('Method Not Allowed', { status: 405 });
        }

        try {
            const { items, email } = await req.json();

            // Calculate total on the server to prevent manipulation
            let amount = 0;
            const prices = {
                1: 2999,
                2: 4995,
                3: 6700
            };
            const upgrades = {
                'upsell-1': 1999,
                'upsell-2': 999
            };

            // Base package
            amount += prices[items.packageId] || 4995;

            // Upgrades
            let lifetimeProtection = false;
            let priorityHandling = false;

            if (items.upgrades) {
                items.upgrades.forEach(upId => {
                    amount += upgrades[upId] || 0;
                    if (upId === 'upsell-1') lifetimeProtection = true;
                    if (upId === 'upsell-2') priorityHandling = true;
                });
            }

            // Coupon Codes - Powered by Stripe
            let discount = 0;
            if (items.coupon) {
                try {
                    const stripeCoupons = await stripe.coupons.list();
                    const matchingCoupon = stripeCoupons.data.find(c =>
                        c.name.toUpperCase() === items.coupon.toUpperCase() ||
                        c.id.toUpperCase() === items.coupon.toUpperCase()
                    );

                    if (matchingCoupon) {
                        if (matchingCoupon.percent_off) {
                            discount = Math.floor(amount * (matchingCoupon.percent_off / 100));
                        } else if (matchingCoupon.amount_off) {
                            discount = matchingCoupon.amount_off;
                        }
                    }
                } catch (couponError) {
                    console.warn('Coupon verification failed, proceeding without discount:', couponError.message);
                }
            }

            amount -= discount;
            if (amount < 50) amount = 50; // Stripe min charge

            const params = {
                amount,
                currency: 'usd',
                metadata: {
                    package: items.packageId,
                    upgrades: items.upgrades ? items.upgrades.join(', ') : 'none',
                    Customer_Size: items.size || 'Not Selected',
                    Lifetime_Protection: lifetimeProtection.toString(),
                    Priority_Handling: priorityHandling.toString(),
                    Coupon_Applied: items.coupon || 'none'
                },
                automatic_payment_methods: {
                    enabled: true,
                },
            };

            if (email && email.trim().length > 0) {
                params.receipt_email = email.trim();
            }

            const paymentIntent = await stripe.paymentIntents.create(params);

            return new Response(JSON.stringify({
                clientSecret: paymentIntent.client_secret,
                amount: amount / 100,
                discount: discount / 100
            }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' }
            });

        } catch (error) {
            console.error('Function error detailing:', {
                message: error.message,
                stack: error.stack,
                type: error.type
            });
            return new Response(JSON.stringify({ error: `Server Error: ${error.message}` }), {
                status: 500,
                headers: { 'Content-Type': 'application/json' }
            });
        }
    } catch (initError) {
        console.error("Initialization Error:", initError);
        return new Response(JSON.stringify({ error: `Init Error: ${initError.message}` }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
};
