import { Collection, Document, ObjectId } from "mongodb";
import { getMongoDb } from "../mongodb.js";
import { BlogPost, ReactionType, SharedBlogPost } from "../types.js";
import { io } from '../socket.js';
import { deleteFileFromS3 } from "../s3.js";
import { offlineMessageManager } from '../offline-messages.js';

io.on('connection', (socket) => {
    const userId = socket.handshake.query.userId as string;

    socket.on('reactToPost', async (data: ReactionType) => {

        try {
            // Connect to MongoDB
            const db = await getMongoDb();
            const collection = db.collection('Users');
            const posts = db.collection('Posts');
            const shares = db.collection('Posts_Shares');
            const comments = db.collection('Posts_Comments');
            let PostsOrSharesOrComments: Collection<Document>;
        
            // Retrieve user and post data
            const user = await collection.findOne({ _id: new ObjectId(userId.toString()) });
        
            if (!user) {
                return io.to(`user:${userId}`).emit("post_reaction_response", { message: `You're not allowed to ${data.type} this post!`, success: false, postId: data.postId, reaction: data.type });
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
                return io.to(`user:${userId}`).emit("post_reaction_response", { message: "Blog is not available!", success: false, postId: data.postId, reaction: data.type });
            }

            if (!data.type) return io.to(`user:${userId}`).emit("post_reaction_response", { message: "This is an invalid reaction!", success: false, postId: data.postId, reaction: data.type });

            const currentCollection = data.type.includes('like') ? db.collection('Posts_Likes') : db.collection('Posts_Bookmarks');
            
            const existingReaction = await currentCollection.findOne({ postId: data.postId, userId: userId });

            if(data.type.includes('un')){
                // Check if the user has already reacted to the post
                if (!existingReaction) {
                    return io.to(`user:${userId}`).emit("post_reaction_response", {
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
                    return io.to(`user:${userId}`).emit("post_reaction_response", {
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

            io.to(`user:${userId}`).emit("post_reaction_response", { message: "Reaction added successfully!", success: true, reaction: data.type });
            
            // Use offline message system instead of direct broadcast
            await offlineMessageManager.broadcastMessage({
                type: 'updatePost',
                data: { 
                    postId: post.PostID,  
                    update: {
                        [data.key]: data.value === 'inc' ? post[data.key] + 1 : post[data.key] - 1
                    },
                    type: data.type
                }
            }, userId);
        } catch (err) {
            console.error('Error processing reaction(reactToPost):', err);
            io.to(`user:${userId}`).emit('error', 'Error processing reaction(reactToPost)');
        }

    })

    socket.on('reactToPost(share)', async (data: {
        action: "share" | "unshare";
        type: "repost" | "quote";
        post: SharedBlogPost;
    }) => {

        try {
            // Connect to MongoDB
            const db = await getMongoDb();
            const collection = db.collection('Users');
            const shares = db.collection('Posts_Shares');
            const posts = db.collection('Posts');
            const comments = db.collection('Posts_Comments');
            let PostsOrSharesOrComments: Collection<Document>;
        
            // Retrieve user and post data
            const user = await collection.findOne({ _id: new ObjectId(userId.toString()) });
        
            if (!user) {
                return io.to(`user:${userId}`).emit("post_reaction_response", { message: `You're not allowed to ${data.type} this post!`, success: false, postId: data.post.PostID, reaction: data.type });
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
                return io.to(`user:${userId}`).emit("post_reaction_response", { message: "Post is not available!", success: false, postId: data.post.PostID, reaction: data.action });
            }

            if (!data.action) return io.to(`user:${userId}`).emit("post_reaction_response", { message: "This is an invalid reaction!", success: false, postId: data.post.PostID, reaction: data.action });

            // Check if the user has already reposted
            const existingRepost = await shares.findOne({ OriginalPostId: data.post.PostID, userId: userId, Type: "repost" });
            
            if(data.action === 'unshare'){
                if (!existingRepost) {
                    return io.to(`user:${userId}`).emit("post_reaction_response", {
                        message: "You have not reposted this post!",
                        success: false,
                        postId: data.post.PostID,
                        reaction: data.action,
                    });
                }
                await shares.deleteOne({ OriginalPostId: data.post.PostID, userId: userId, Type: "repost" })

                await PostsOrSharesOrComments.updateOne(
                    { PostID: data.post.PostID }, 
                    { $inc: { NoOfShares: -1 } }
                );

                // Use offline message system for post updates
                await offlineMessageManager.broadcastMessage({
                    type: 'deletePost',
                    data: { 
                        postId: post.PostID,
                        type: data.action
                    }
                }, userId);
            } else {
                if (data.type === "repost") {
                    if (existingRepost) {
                        return io.to(`user:${userId}`).emit("post_reaction_response", {
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
                        IsFollowing: false,
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
            
                    // Use offline message system for post updates
                    await offlineMessageManager.broadcastMessage({
                        type: 'updatePost',
                        data: { 
                            postId: data.post.PostID, 
                            update: {
                                NoOfShares: data.action === 'share' ? post.NoOfShares + 1 : post.NoOfShares - 1
                            },
                            type: data.action 
                        }
                    }, userId);
        
                    await offlineMessageManager.broadcastMessage({
                        type: 'newPost',
                        data: {
                            blog: repost,
                        }
                    }, userId);
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
                        IsFollowing: false,
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
                        OriginalPostId: data.post.OriginalPostId,
                    };
                    quote.PostID = quote._id.toString();
        
                    await shares.insertOne(quote);
                    await PostsOrSharesOrComments.updateOne(
                        { PostID: data.post.OriginalPostId },
                        { $inc: { NoOfShares: 1 } }
                    );
            
                    // Use offline message system for post updates
                    await offlineMessageManager.broadcastMessage({
                        type: 'updatePost',
                        data: { 
                            postId: data.post.OriginalPostId, 
                            update: {
                                NoOfShares: data.action === 'share' ? post.NoOfShares + 1 : post.NoOfShares - 1
                            },
                            type: data.action 
                        }
                    }, userId);
        
                    await offlineMessageManager.broadcastMessage({
                        type: 'newPost',
                        data: {
                            blog: quote,
                        }
                    }, userId);
                }
            }

            io.to(`user:${userId}`).emit("post_reaction_response", { message: `Post ${data.action}d successfully!`, success: true, reaction: data.action });
        } catch (err) {
            console.error('Error processing reaction(reactToPost(share)):', err);
            io.to(`user:${userId}`).emit('error', 'Error processing reaction(reactToPost(share))');
        }

    })

    socket.on('post', async (data: BlogPost) => {

        try {
            // Connect to MongoDB
            const db = await getMongoDb();
            const collection = db.collection('Users');
            const posts = db.collection('Posts');
            const comments = db.collection('Posts_Comments');
            const shares = db.collection('Posts_Shares');
            let PostsOrSharesOrComments: Collection<Document>;
        
            // Retrieve user and post data
            const user = await collection.findOne({ _id: new ObjectId(userId.toString()) });
        
            if (!user) {
                return io.to(`user:${userId}`).emit("post_response", { message: `You're not allowed to ${data.Type}!`, success: false });
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
                IsFollowing: false,
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
            };
            blog.PostID = blog._id.toString();
            // console.log(data)
        
            if(blog.Type === 'comment') {
                if (!data.ParentId) {
                    return io.to(`user:${userId}`).emit("post_response", { 
                        message: "ParentId is needed!", 
                        success: false 
                    });
                }
                // Check if the post exists in the posts collection
                let post = await posts.findOne({ PostID: data.ParentId });
                PostsOrSharesOrComments = posts;
                
                // If not found, check in the shares collection
                if (!post) {
                    post = await shares.findOne({ PostId: data.ParentId });
                    PostsOrSharesOrComments = shares;
                } 
                
                if (!post) {
                    // Check if the post is a comment
                    post = await comments.findOne({ PostID: data.ParentId });
                    PostsOrSharesOrComments = comments;
                }

                if (!post) {
                    return io.to(`user:${userId}`).emit("post_reaction_response", { message: "Post is not available!", success: false, postId: data.PostID, reaction: data.Type });
                }

                // Save the new comment and update the post
                await comments.insertOne(blog);
            
                await PostsOrSharesOrComments.updateOne({ PostID: data.ParentId }, { $inc: { NoOfComment: 1} });

                // Use offline message system for new comments
                await offlineMessageManager.broadcastMessage({
                    type: 'newComment',
                    data: { 
                        blog: blog 
                    }
                }, userId);

                await offlineMessageManager.broadcastMessage({
                    type: 'updatePost',
                    data: { 
                        postId: blog.ParentId, 
                        update: {
                            NoOfComment: post.NoOfComment + 1
                        },
                        type: blog.Type 
                    }
                }, userId);
            } else {
                await posts.insertOne(blog)
                
                // Use offline message system for new posts
                await offlineMessageManager.broadcastMessage({
                    type: 'newPost',
                    data: { 
                        blog: blog 
                    }
                }, userId);
            }
        
            io.to(`user:${userId}`).emit("post_response", { 
                message: `${data.Type.toUpperCase()} added successfully!`, 
                success: true 
            });

        } catch (err) {
            console.error('Error processing form data:', err);
            io.to(`user:${userId}`).emit('error', 'Error processing form data');
        }

    });
    
    socket.on('deletePost', async (data: { postId: string }) => {

        try {
            if (!data.postId) {
                return io.to(`user:${userId}`).emit("delete_post_response", { 
                    message: "PostId is needed!", 
                    success: false 
                });
            }

            // Connect to MongoDB
            const db = await getMongoDb();
            const posts = db.collection('Posts');
            const shares = db.collection('Posts_Shares');
            const comments = db.collection('Posts_Comments');
            let PostsOrSharesOrComments: Collection<Document>;

            // Check if the post exists in the posts collection
            let post = await posts.findOne({ PostID: data.postId });
            PostsOrSharesOrComments = posts;

            // If not found, check in the shares collection
            if (!post) {
                post = await shares.findOne({ PostID: data.postId });
                PostsOrSharesOrComments = shares;
            }

            // If not found, check in the comments collection
            if (!post) {
                post = await comments.findOne({ PostID: data.postId });
                PostsOrSharesOrComments = comments;
            }

            if (!post) {
                return io.to(`user:${userId}`).emit("delete_post_response", { 
                    message: "Post not found!", 
                    success: false 
                });
            }

            // Delete the post
            await PostsOrSharesOrComments.deleteOne({ PostID: data.postId });
            await db.collection('Posts_Likes').deleteMany({ OriginalPostId: data.postId }); 
            await db.collection('Posts_Bookmarks').deleteMany({ OriginalPostId: data.postId });
            await shares.deleteMany({ OriginalPostId: data.postId });
            await comments.deleteMany({ ParentId: data.postId });

            if(post.Image.length > 0) {
                post.Image.map(async (media: string) => {
                    await deleteFileFromS3('post-s', [media]);
                })
            }
            // If the post is a comment, update the parent post
            if(post.Type === 'comment') {
                await offlineMessageManager.broadcastMessage({
                    type: 'updatePost',
                    data: { 
                        postId: post.ParentId, 
                        update: {
                            NoOfComments: post.NoOfComments > 0 ? post.NoOfComments - 1 : 0
                        },
                        type: post.Type 
                    }
                }, userId);
            }

            // Use offline message system for post deletion
            await offlineMessageManager.broadcastMessage({
                type: 'deletePost',
                data: { 
                    postId: data.postId 
                }
            }, userId);

            io.to(`user:${userId}`).emit("delete_post_response", { 
                message: "Post deleted successfully!", 
                success: true 
            });
        } catch (err) {
            console.error('Error deleting post:', err);
            io.to(`user:${userId}`).emit("delete_post_response", { 
                message: "Error deleting post!", 
                success: false 
            });
        }

    })
})