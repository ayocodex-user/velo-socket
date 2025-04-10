import { Collection, ObjectId } from "mongodb";
import { getMongoDb } from "../mongodb.js";
import { BlogPost, ReactionType, SharedBlogPost } from "../types.js";
import { io } from '../socket.js';

io.on('connection', (socket) => {
    const userId = socket.handshake.query.userId as string;

    socket.on('reactToPost', async (data: ReactionType) => {
        // Connect to MongoDB
        const db = await getMongoDb();
        const collection = db.collection('Users');
        const posts = db.collection('Posts');
        const shares = db.collection('Posts_Shares');
        const comments = db.collection('Posts_Comments');
        let PostsOrSharesOrComments;
    
        // Retrieve user and post data
        const user = await collection.findOne({ _id: new ObjectId(userId.toString()) });
    
        if (!user) {
            return socket.to(`user:${userId}`).emit("post_reaction_reponse", { message: `You're not allowed to ${data.type} this post!`, success: false, postId: data.postId, reaction: data.type });
        }
        // Check if the post exists in the posts collection
        let post = await posts.findOne({ PostID: data.postId });
        PostsOrSharesOrComments = posts;
        
        // If not found, check in the shares collection
        if (!post) {
            post = await shares.findOne({ PostID: data.postId });
            PostsOrSharesOrComments = shares;
        } 
        
        if (!post) {
            // Check if the post is a comment
            post = await comments.findOne({ PostID: data.postId });
            PostsOrSharesOrComments = comments;
        }

        if (!post) {
            return socket.to(`user:${userId}`).emit("post_reaction_reponse", { message: "Blog is not available!", success: false, postId: data.postId, reaction: data.type });
        }

        if (!data.type) return socket.to(`user:${userId}`).emit("post_reaction_reponse", { message: "This is an invalid reaction!", success: false, postId: data.postId, reaction: data.type });

        const currentCollection = data.type.includes('like') ? db.collection('Posts_Likes') : db.collection('Posts_Bookmarks');
        
        const existingReaction = await currentCollection.findOne({ postId: data.postId, userId: userId });

        if(data.type.includes('un')){
            // Check if the user has already reacted to the post
            if (!existingReaction) {
                return socket.to(`user:${userId}`).emit("post_reaction_reponse", {
                    message: `You have not ${data.type} this post!`,
                    success: false,
                    postId: data.postId,
                    reaction: data.type,
                });
            }
            // Remove the reaction
            await currentCollection.deleteOne({ postId: data.postId, userId: userId })

            
            await PostsOrSharesOrComments.updateOne(
                { PostID: data.postId }, 
                { $inc: { [data.key]: -1 } } // if data.type is like -> { $inc: { [`NoOfLikes`]: -1 } }
            );
        } else {
            // Check if the user has already reacted to the post
            if (existingReaction) {
                return socket.to(`user:${userId}`).emit("post_reaction_reponse", {
                    message: `You have already ${data.type} this post!`,
                    success: false,
                    postId: data.postId,
                    reaction: data.type,
                });
            }
            // Add the reaction
            await currentCollection.insertOne({ postId: data.postId, userId: userId })

            
            await PostsOrSharesOrComments.updateOne(
                { PostID: data.postId }, 
                { $inc: { [data.key]: 1 } } // if data.type is like -> { $inc: { [`NoOfLikes`]: 1 } }
            );
        }

        socket.to(`user:${userId}`).emit("post_reaction_reponse", { message: "Reaction added successfully!", success: true, reaction: data.type });
        
        socket.emit("updatePost", { 
            excludeUser: userId,
            postId: post.PostID,  
            update: {
                [data.key]: data.value === 'inc' ? post[data.key] + 1 : post[data.key] - 1
            },
            type: data.type
        })

    })

    socket.on('reactToPost(share)', async (data: {
        action: "share" | "unshare";
        type: "repost" | "quote";
        post: SharedBlogPost;
    }) => {
        // Connect to MongoDB
        const db = await getMongoDb();
        const collection = db.collection('Users');
        const shares = db.collection('Posts_Shares');
        const posts = db.collection('Posts');
        const comments = db.collection('Posts_Comments');
        let PostsOrSharesOrComments;
    
        // Retrieve user and post data
        const user = await collection.findOne({ _id: new ObjectId(userId.toString()) });
    
        if (!user) {
            return socket.to(`user:${userId}`).emit("post_reaction_reponse", { message: `You're not allowed to ${data.type} this post!`, success: false, postId: data.post.PostID, reaction: data.type });
        }
        // Check if the post exists in the posts collection
        let post = await posts.findOne({ PostID: data.post.OriginalPostId });
        PostsOrSharesOrComments = posts;
        
        // If not found, check in the shares collection
        if (!post) {
            post = await shares.findOne({ PostId: data.post.OriginalPostId });
            PostsOrSharesOrComments = shares;
        } 
        
        if (!post) {
            // Check if the post is a comment
            post = await comments.findOne({ PostID: data.post.OriginalPostId });
            PostsOrSharesOrComments = comments;
        }

        if (!post) {
            return socket.to(`user:${userId}`).emit("post_reaction_reponse", { message: "Post is not available!", success: false, postId: data.post.PostID, reaction: data.action });
        }

        if (!data.action) return socket.to(`user:${userId}`).emit("post_reaction_reponse", { message: "This is an invalid reaction!", success: false, postId: data.post.PostID, reaction: data.action });

        // Check if the user has already reposted
        const existingRepost = await shares.findOne({ OriginalPostId: data.post.PostID, userId: userId, Type: "repost" });
        
        if(data.action === 'unshare'){
            if (!existingRepost) {
                return socket.to(`user:${userId}`).emit("post_reaction_reponse", {
                    message: "You have not reposted this post!",
                    success: false,
                    postId: data.post.PostID,
                    reaction: data.action,
                });
            }
            await shares.deleteOne({ OriginalPostId: data.post.OriginalPostId, userId: userId, Type: "repost" })

            await PostsOrSharesOrComments.updateOne(
                { PostID: data.post.OriginalPostId }, 
                { $inc: { NoOfShares: -1 } }
            );

            socket.emit("deletePost", { 
                excludeUserId: userId,
                postId: post.PostID,
                type: data.action
            })
        } else {
            if (data.type === "repost") {
                if (existingRepost) {
                    return socket.to(`user:${userId}`).emit("post_reaction_reponse", {
                        message: "You have already reposted this post!",
                        success: false,
                        postId: data.post.PostID,
                        reaction: data.action,
                    });
                }
    
                // Create a new repost (only references the original post)
                const repost = {
                    _id: new ObjectId(),
                    UserId: userId,
                    DisplayPicture: user.displayPicture || "",
                    NameOfPoster: `${user.firstname ?? ""} ${user.lastname ?? ""}`.trim(),
                    Verified: user.Verified ?? false,
                    Username: user.username || "",
                    Type: "repost",
                    PostID: "",
                    OriginalPostId: data.post.PostID,
                    TimeOfPost: new Date().toISOString(),
                };
                repost.PostID = repost._id.toString();

                await shares.insertOne(repost);
                await PostsOrSharesOrComments.updateOne(
                    { PostID: data.post.PostID },
                    { $inc: { NoOfShares: 1 } }
                );
        
                socket.emit("updatePost", { 
                    excludeUserId: userId,
                    postId: data.post.PostID, 
                    update: {
                        NoOfShares: data.action === 'share' ? post.NoOfShares + 1 : post.NoOfShares - 1
                    },
                    type: data.action 
                })
    
                socket.emit("newPost", {
                    excludeUser: userId,
                    blog: repost,
                });
            } else if (data.type === "quote") {
                // Create a new quoted post
                const quote: SharedBlogPost = {
                    _id: new ObjectId(),
                    ParentId: "",
                    UserId: userId,
                    DisplayPicture: user.displayPicture || "",
                    NameOfPoster: `${user.firstname ?? ""} ${user.lastname ?? ""}`.trim(),
                    Verified: user.Verified ?? false,
                    TimeOfPost: new Date().toISOString(),
                    Visibility: data.post.Visibility,
                    Caption: data.post.Caption ?? "", // Include user's caption
                    Image: data.post.Image ?? [],
                    NoOfLikes: 0,
                    Liked: false,
                    NoOfComment: 0,
                    NoOfShares: 0,
                    NoOfBookmarks: 0,
                    Bookmarked: false,
                    Shared: false,
                    Username: user.username || "",
                    Code: data.post.Code,
                    WhoCanComment: data.post.WhoCanComment,
                    Type: "quote",
                    PostID: "",
                    isDeleted: false,
                    OriginalPostId: data.post.OriginalPostId,
                };
                quote.PostID = quote._id.toString();
    
                await shares.insertOne(quote);
                await PostsOrSharesOrComments.updateOne(
                    { PostID: data.post.OriginalPostId },
                    { $inc: { NoOfShares: 1 } }
                );
        
                socket.emit("updatePost", { 
                    excludeUserId: userId,
                    postId: data.post.OriginalPostId, 
                    update: {
                        NoOfShares: data.action === 'share' ? post.NoOfShares + 1 : post.NoOfShares - 1
                    },
                    type: data.action 
                })
    
                socket.emit("newPost", {
                    excludeUser: userId,
                    blog: quote,
                });
            }
        }

        socket.to(`user:${userId}`).emit("post_reaction_reponse", { message: `Post ${data.action}d successfully!`, success: true, reaction: data.action });

    })

    socket.on('post', async (data: BlogPost) => {
        try {

            // Connect to MongoDB
            const db = await getMongoDb();
            const collection = db.collection('Users');
            const post = db.collection('Posts');
            const comments = db.collection('Posts_Comments');
        
            // Retrieve user and post data
            const user = await collection.findOne({ _id: new ObjectId(userId.toString()) });
        
            if (!user) {
                return socket.to(`user:${userId}`).emit("post_response", { message: `You're not allowed to ${data.Type}!`, success: false });
            }
        
            // Create a new blog
            const blog: BlogPost = {
                _id: new ObjectId(),
                ParentId: data.ParentId || '',
                UserId: userId,
                DisplayPicture: user.displayPicture || '',
                NameOfPoster: `${user.firstname ?? ''} ${user.lastname ?? ''}`.trim(),
                Verified: user.Verified ?? false,
                TimeOfPost: data.TimeOfPost ?? new Date().toISOString(),
                Visibility: data.Visibility,
                Caption: data.Caption ?? '',
                Image: data.Image ?? [],
                NoOfLikes: 0,
                Liked: false,
                NoOfComment: 0,
                NoOfShares: 0,
                NoOfBookmarks: 0,
                Bookmarked: false,
                Shared: false,
                Username: user.username || '',
                Code: data.Code,
                WhoCanComment: data.WhoCanComment,
                Type: data.Type,
                PostID: "",
                isDeleted: false
            };
            blog.PostID = blog._id.toString();
        
            if(blog.Type === 'comment') {
                // Save the new comment and update the post
                await comments.insertOne(blog);
            
                await post.updateOne({ PostID: data.ParentId }, { $inc: { NoOfComment: 1} });
            } else {
                await post.insertOne(blog)
            }
        
            socket.to(`user:${userId}`).emit("post_response", { 
                message: `${data.Type.toUpperCase()} added successfully!`, 
                success: true 
            });

            socket.emit("newPost", { 
                excludeUser: userId, 
                blog: blog 
            })

        } catch (err) {
            console.error('Error processing form data:', err);
            socket.emit('error', 'Error processing form data');
        }
    });
})