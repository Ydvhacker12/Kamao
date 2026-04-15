// Firebase Cloud Functions for Auto Notifications
// Deploy with: firebase deploy --only functions

const functions = require('firebase-functions');
const admin = require('firebase-admin');

// Initialize Firebase Admin SDK
admin.initializeApp();

// Get Firestore and Realtime Database references
const db = admin.database();
const firestore = admin.firestore();

// Helper function to send push notification
async function sendPushNotification(userId, title, body, data = {}) {
    try {
        // Get user's FCM token
        const userRef = db.ref(`users/${userId}/fcmToken`);
        const snapshot = await userRef.once('value');
        
        if (!snapshot.exists()) {
            console.log(`No FCM token found for user ${userId}`);
            return;
        }
        
        const tokenData = snapshot.val();
        const fcmToken = tokenData.token;
        
        if (!fcmToken) {
            console.log(`Empty FCM token for user ${userId}`);
            return;
        }
        
        // Prepare notification payload
        const message = {
            notification: {
                title: title,
                body: body
            },
            data: {
                ...data,
                click_action: 'FLUTTER_NOTIFICATION_CLICK'
            },
            token: fcmToken
        };
        
        // Send notification
        const response = await admin.messaging().send(message);
        console.log(`Notification sent to user ${userId}: ${response}`);
        
        // Save notification to user's notifications
        const notificationRef = db.ref(`notifications/${userId}`);
        await notificationRef.push({
            title: title,
            message: body,
            timestamp: admin.database.ServerValue.TIMESTAMP,
            read: false,
            type: data.type || 'system'
        });
        
    } catch (error) {
        console.error(`Error sending notification to user ${userId}:`, error);
    }
}

// 1. Deposit Success Notification
exports.onDepositSuccess = functions.database.ref('/payments/{paymentId}')
    .onWrite(async (change, context) => {
        const paymentId = context.params.paymentId;
        const paymentData = change.after.val();
        
        // Only trigger when status changes to "success"
        if (!paymentData || paymentData.status !== 'success') {
            return null;
        }
        
        const userId = paymentData.userId;
        const amount = paymentData.amount || 0;
        
        if (!userId) {
            console.log(`No userId found for payment ${paymentId}`);
            return null;
        }
        
        // Send notification
        await sendPushNotification(
            userId,
            'Deposit Successful',
            `₹${amount} added to your wallet`,
            {
                type: 'deposit_success',
                paymentId: paymentId,
                amount: amount.toString()
            }
        );
        
        return null;
    });

// 2. Withdrawal Approved Notification
exports.onWithdrawalApproved = functions.database.ref('/withdrawals/{withdrawalId}')
    .onWrite(async (change, context) => {
        const withdrawalId = context.params.withdrawalId;
        const withdrawalData = change.after.val();
        
        // Only trigger when status changes to "approved"
        if (!withdrawalData || withdrawalData.status !== 'approved') {
            return null;
        }
        
        const userId = withdrawalData.userId;
        const amount = withdrawalData.amount || 0;
        
        if (!userId) {
            console.log(`No userId found for withdrawal ${withdrawalId}`);
            return null;
        }
        
        // Send notification
        await sendPushNotification(
            userId,
            'Withdrawal Successful',
            `Your withdrawal of ₹${amount} has been approved and processed`,
            {
                type: 'withdrawal_approved',
                withdrawalId: withdrawalId,
                amount: amount.toString()
            }
        );
        
        return null;
    });

// 3. Withdrawal Rejected Notification
exports.onWithdrawalRejected = functions.database.ref('/withdrawals/{withdrawalId}')
    .onWrite(async (change, context) => {
        const withdrawalId = context.params.withdrawalId;
        const withdrawalData = change.after.val();
        
        // Only trigger when status changes to "rejected"
        if (!withdrawalData || withdrawalData.status !== 'rejected') {
            return null;
        }
        
        const userId = withdrawalData.userId;
        const amount = withdrawalData.amount || 0;
        const reason = withdrawalData.rejectionReason || 'No reason provided';
        
        if (!userId) {
            console.log(`No userId found for withdrawal ${withdrawalId}`);
            return null;
        }
        
        // Send notification
        await sendPushNotification(
            userId,
            'Withdrawal Rejected',
            `Your withdrawal of ₹${amount} was rejected. Reason: ${reason}`,
            {
                type: 'withdrawal_rejected',
                withdrawalId: withdrawalId,
                amount: amount.toString(),
                reason: reason
            }
        );
        
        return null;
    });

// 4. Tournament Start Notification
exports.onTournamentStart = functions.database.ref('/tournaments/{tournamentId}')
    .onWrite(async (change, context) => {
        const tournamentId = context.params.tournamentId;
        const tournamentData = change.after.val();
        
        // Only trigger when status changes to "live"
        if (!tournamentData || tournamentData.status !== 'live') {
            return null;
        }
        
        const tournamentName = tournamentData.name || 'Tournament';
        const gameName = tournamentData.gameName || 'Game';
        
        // Get all registered players
        const registeredPlayers = tournamentData.registeredPlayers || {};
        const playerIds = Object.keys(registeredPlayers);
        
        if (playerIds.length === 0) {
            console.log(`No registered players for tournament ${tournamentId}`);
            return null;
        }
        
        console.log(`Sending tournament start notifications to ${playerIds.length} players`);
        
        // Send notification to each player
        const promises = playerIds.map(async (userId) => {
            await sendPushNotification(
                userId,
                'Tournament Started!',
                `${tournamentName} (${gameName}) has started. Join now!`,
                {
                    type: 'tournament_start',
                    tournamentId: tournamentId,
                    tournamentName: tournamentName,
                    gameName: gameName
                }
            );
        });
        
        await Promise.all(promises);
        
        return null;
    });

// 5. Tournament Result Notification
exports.onTournamentResult = functions.database.ref('/tournaments/{tournamentId}')
    .onWrite(async (change, context) => {
        const tournamentId = context.params.tournamentId;
        const tournamentData = change.after.val();
        
        // Only trigger when status changes to "result"
        if (!tournamentData || tournamentData.status !== 'result') {
            return null;
        }
        
        const tournamentName = tournamentData.name || 'Tournament';
        
        // Get winners from results
        const results = tournamentData.results || {};
        const winners = Object.keys(results).slice(0, 3); // Top 3 winners
        
        if (winners.length === 0) {
            console.log(`No winners found for tournament ${tournamentId}`);
            return null;
        }
        
        console.log(`Sending tournament result notifications to ${winners.length} winners`);
        
        // Send notification to each winner
        const promises = winners.map(async (userId, index) => {
            const position = index + 1;
            const prize = results[userId]?.prize || 0;
            
            await sendPushNotification(
                userId,
                `Tournament Result - ${position}${getOrdinalSuffix(position)} Place!`,
                `Congratulations! You secured ${position}${getOrdinalSuffix(position)} place in ${tournamentName} and won ₹${prize}`,
                {
                    type: 'tournament_result',
                    tournamentId: tournamentId,
                    tournamentName: tournamentName,
                    position: position.toString(),
                    prize: prize.toString()
                }
            );
        });
        
        return null;
    });

// Helper function for ordinal suffixes
function getOrdinalSuffix(n) {
    const suffixes = ['th', 'st', 'nd', 'rd'];
    const v = n % 100;
    return suffixes[(v - 20) % 10] || suffixes[v] || suffixes[0];
}

// 6. New Tournament Created Notification (Optional - for all users)
exports.onNewTournamentCreated = functions.database.ref('/tournaments/{tournamentId}')
    .onCreate(async (snapshot, context) => {
        const tournamentId = context.params.tournamentId;
        const tournamentData = snapshot.val();
        
        if (!tournamentData || tournamentData.status !== 'upcoming') {
            return null;
        }
        
        const tournamentName = tournamentData.name || 'New Tournament';
        const gameName = tournamentData.gameName || 'Game';
        const entryFee = tournamentData.entryFee || 0;
        const startTime = tournamentData.startTime || '';
        
        // In a real app, you might want to send to all users or users interested in this game
        // For now, we'll just log it
        console.log(`New tournament created: ${tournamentName} (${gameName})`);
        
        return null;
    });

// 7. User Referral Bonus Notification
exports.onReferralBonus = functions.database.ref('/referrals/{referralId}')
    .onCreate(async (snapshot, context) => {
        const referralId = context.params.referralId;
        const referralData = snapshot.val();
        
        if (!referralData) {
            return null;
        }
        
        const newUserId = referralData.new_user_id;
        const referrerId = referralData.referrer_user_id;
        const newUserBonus = referralData.bonus_amount_new_user || 0;
        const referrerBonus = referralData.bonus_amount_referrer || 0;
        
        // Send notification to new user
        if (newUserId && newUserBonus > 0) {
            await sendPushNotification(
                newUserId,
                'Welcome Bonus!',
                `You received ₹${newUserBonus} welcome bonus for joining with referral`,
                {
                    type: 'referral_bonus',
                    bonusAmount: newUserBonus.toString(),
                    isNewUser: 'true'
                }
            );
        }
        
        // Send notification to referrer
        if (referrerId && referrerBonus > 0) {
            await sendPushNotification(
                referrerId,
                'Referral Bonus Earned!',
                `You earned ₹${referrerBonus} for referring a new user`,
                {
                    type: 'referral_bonus',
                    bonusAmount: referrerBonus.toString(),
                    isReferrer: 'true'
                }
            );
        }
        
        return null;
    });